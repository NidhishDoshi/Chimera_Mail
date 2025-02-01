import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from datetime import datetime, timedelta
import google.generativeai as genai
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.schema import Document
from dateutil import parser
import base64
import json
from typing import List, Optional
from email.utils import parsedate_to_datetime
import re
from langchain_community.vectorstores.utils import filter_complex_metadata
from fastapi import Query
from google.api_core import retry
from concurrent.futures import ThreadPoolExecutor
import asyncio
from typing import List, Dict
import time
from typing import List, Dict
from datetime import date
import pytz 
from fastapi import Depends, HTTPException,status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from contextlib import asynccontextmanager
from typing import AsyncGenerator
import weakref
from functools import wraps
import gc
from fastapi import BackgroundTasks
app = FastAPI()
security = HTTPBearer()
# Initialize Embeddings
embedding_function = HuggingFaceEmbeddings(
    model_name="dunzhang/stella_en_400M_v5",
    encode_kwargs={'normalize_embeddings': True},
    model_kwargs={'trust_remote_code': True}
)

# Initialize ChromaDB
CHROMA_PERSIST_DIR = "chroma_db"
db = Chroma(
    persist_directory=CHROMA_PERSIST_DIR,
    embedding_function=embedding_function,
)

# Initialize Gemini
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.0-flash-exp')

# Gmail API setup
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

def get_gmail_service():
    # Instead of handling OAuth flow, accept token from frontend
    def build_service_with_token(token):
        credentials = Credentials(
            token=token,
            refresh_token=None,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=os.getenv('CLIENT_ID'),
            client_secret=os.getenv('CLIENT_SECRET'),
            scopes=SCOPES
        )
        return build('gmail', 'v1', credentials=credentials)
    
    return build_service_with_token

def extract_text_from_payload(payload, depth=0, max_depth=10):
    """Recursively extract text content from email payload parts with lenient processing"""
    if depth > max_depth:
        return "Content too deeply nested"
        
    text = ""
    
    try:
        # Handle missing mimeType
        mime_type = payload.get('mimeType', 'unknown')
        
        if mime_type == 'text/plain':
            # Try to get body data, return empty string if not found
            body = payload.get('body', {})
            data = body.get('data', '')
            if data:
                text += base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
                
        elif mime_type == 'text/html':
            body = payload.get('body', {})
            data = body.get('data', '')
            if data:
                html_content = base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
                # Simple HTML cleaning
                text += re.sub('<[^<]+?>', ' ', html_content)
                
        elif mime_type.startswith('multipart/'):
            # Process parts if they exist
            for part in payload.get('parts', []):
                text += extract_text_from_payload(part, depth + 1)
                
    except Exception as e:
        print(f"Warning in content extraction: {str(e)}")
        # Continue despite errors
        
    return text

def extract_mail_content(message):
    """Extract email content and metadata with very lenient processing"""
    try:
        # Always create metadata even with missing elements
        headers = {}
        if 'payload' in message and 'headers' in message['payload']:
            for header in message['payload']['headers']:
                headers[header['name'].lower()] = header['value']
        
        # Metadata with fallbacks for everything
        metadata = {
            'id': message.get('id', 'Unavailable'),
            'threadId': message.get('threadId', 'Unavailable'),
            'date': headers.get('date', 'Unavailable'),
            'labels': ','.join(message.get('labelIds', ['Unavailable'])),
            'subject': headers.get('subject', 'Unavailable'),
            'from': headers.get('from', 'Unavailable'),
            'to': headers.get('to', 'Unavailable'),
        }

        content = "No content available"
        
        # Try to extract content if payload exists
        if 'payload' in message:
            extracted_content = extract_text_from_payload(message['payload'])
            if extracted_content and extracted_content.strip():
                content = ' '.join(extracted_content.split())
        
        # Always return something, even if minimal
        return {
            'metadata': metadata,
            'content': content
        }
        
    except Exception as e:
        print(f"Warning while processing message: {str(e)}")
        # Return minimal data even on error
        return {
            'metadata': {
                'id': message.get('id', 'Unavailable'),
                'threadId': message.get('threadId', 'Unavailable'),
                'date': 'Unavailable',
                'labels': 'Unavailable',
                'subject': 'Unavailable',
                'from': 'Unavailable',
                'to': 'Unavailable'
            },
            'content': 'Error processing message content'
        }

@app.get("/get_emails")
async def get_emails(credentials: HTTPAuthorizationCredentials = Depends(security), max_emails: int = Query(default=50, ge=1, le=10000, description="Number of latest emails to process")):
    "Initialize database with specified number of latest emails using optimized batch requests"""
    token = credentials.credentials
    service = get_gmail_service()(token)
    start_time = time.time()
    # service = get_gmail_service()
    
    # Step 1: Get message IDs efficiently using list() with fields parameter
    messages = []
    request = service.users().messages().list(
        userId='me',
        maxResults=max_emails,
        includeSpamTrash=False,
        fields='messages(id,threadId),nextPageToken'  # Include threadId in fields
    )
    
    while request is not None:
        response = request.execute()
        messages.extend(response.get('messages', []))
        
        request = service.users().messages().list_next(request, response)
        if len(messages) >= max_emails:
            messages = messages[:max_emails]
            break

    # Step 2: Fetch full messages in parallel batches
    async def process_message_batch(batch_ids: List[str]) -> List[Document]:
        documents = []
        batch = service.new_batch_http_request()
        responses: Dict[str, dict] = {}

        def callback(request_id, response, exception):
            if exception is None:
                responses[request_id] = response

        # Add all requests to batch with minimal fields, including threadId
        for msg_id in batch_ids:
            request = service.users().messages().get(
                userId='me',
                id=msg_id,
                format='full',
                fields='id,threadId,payload,internalDate,labelIds'  # Include threadId
            )
            batch.add(request, callback=callback, request_id=msg_id)

        await asyncio.get_event_loop().run_in_executor(None, batch.execute)
        
        # Process responses with better error handling
        for msg_id, message in responses.items():
            try:
                # Ensure required fields exist
                if not all(field in message for field in ['id', 'threadId', 'payload']):
                    missing_fields = [field for field in ['id', 'threadId', 'payload'] if field not in message]
                    print(f"Message {msg_id} missing required fields: {missing_fields}")
                    continue

                mail_data = extract_mail_content(message)
                if not mail_data:
                    print(f"Failed to extract content from message {msg_id}")
                    continue
                    
                if not mail_data.get('content'):
                    print(f"No content extracted from message {msg_id}")
                    continue

                # Create document with all required fields
                doc = Document(
                    page_content=(
                        f"Date: {mail_data['metadata']['date']}\n"
                        f"From: {mail_data['metadata']['from']}\n"
                        f"To: {mail_data['metadata']['to']}\n"
                        f"Subject: {mail_data['metadata']['subject']}\n\n"
                        f"{mail_data['content']}"
                    ),
                    metadata={
                        **mail_data['metadata'],
                        'threadId': message['threadId'],  # Ensure threadId is included
                        'processed_timestamp': time.time()
                    }
                )
                documents.append(doc)
            except Exception as e:
                print(f"Error processing message {msg_id}: {str(e)}")
                continue
                
        return documents

    # Process messages in parallel batches
    batch_size = 100  # Gmail API batch limit
    all_documents = []
    tasks = []
    
    for i in range(0, len(messages), batch_size):
        batch_ids = [msg['id'] for msg in messages[i:i + batch_size]]
        tasks.append(process_message_batch(batch_ids))
    
    # Execute all batches concurrently
    batch_results = await asyncio.gather(*tasks)
    
    # Collect successful documents and error counts
    error_count = 0
    for docs in batch_results:
        all_documents.extend(docs)
        error_count += (batch_size - len(docs))

    # Step 3: Bulk insert into ChromaDB with error handling
    successful_imports = 0
    # if all_documents:
    #     try:
    #         db.add_documents(all_documents)
    #         successful_imports = len(all_documents)
    #     except Exception as e:
    #         print(f"Error during bulk import to ChromaDB: {str(e)}")
    #         # Fallback to smaller batches if bulk import fails
    #         for i in range(0, len(all_documents), 50):
    #             try:
    #                 batch = all_documents[i:i + 50]
    #                 db.add_documents(batch)
    #                 successful_imports += len(batch)
    #             except Exception as e:
    #                 print(f"Error importing batch {i}-{i+50}: {str(e)}")

    end_time = time.time()
    processing_time = end_time - start_time
    
    return {
        
        "message": f"Processed {len(all_documents)}/{len(messages)} emails in {processing_time:.2f} seconds",
        "details": {
            "requested": max_emails,
            "processed": len(all_documents),
            "skipped": len(messages) - len(all_documents),
            "processing_time": processing_time,"status": all_documents
        }
    }

# /initialize_db?max_emails=100
@app.post("/initialize_db")
async def initialize_db(
    credentials: HTTPAuthorizationCredentials = Depends(security),max_emails: int = Query(default=200, ge=1, le=10000, description="Number of latest emails to process")
):
    token = credentials.credentials
    start_time = time.time()
    service = get_gmail_service()(token)
    
    # Step 1: Get message IDs efficiently using list() with fields parameter
    messages = []
    request = service.users().messages().list(
        userId='me',
        maxResults=max_emails,
        includeSpamTrash=False,
        fields='messages(id,threadId),nextPageToken'  # Include threadId in fields
    )
    
    while request is not None:
        response = request.execute()
        messages.extend(response.get('messages', []))
        
        request = service.users().messages().list_next(request, response)
        if len(messages) >= max_emails:
            messages = messages[:max_emails]
            break

    # Step 2: Fetch full messages in parallel batches
    async def process_message_batch(batch_ids: List[str]) -> List[Document]:
        documents = []
        batch = service.new_batch_http_request()
        responses: Dict[str, dict] = {}

        def callback(request_id, response, exception):
            if exception is None:
                responses[request_id] = response

        # Add all requests to batch with minimal fields, including threadId
        for msg_id in batch_ids:
            request = service.users().messages().get(
                userId='me',
                id=msg_id,
                format='full',
                fields='id,threadId,payload,internalDate,labelIds'  # Include threadId
            )
            batch.add(request, callback=callback, request_id=msg_id)

        await asyncio.get_event_loop().run_in_executor(None, batch.execute)
        
        # Process responses with better error handling
        for msg_id, message in responses.items():
            try:
                # Ensure required fields exist
                if not all(field in message for field in ['id', 'threadId', 'payload']):
                    missing_fields = [field for field in ['id', 'threadId', 'payload'] if field not in message]
                    print(f"Message {msg_id} missing required fields: {missing_fields}")
                    continue

                mail_data = extract_mail_content(message)
                if not mail_data:
                    print(f"Failed to extract content from message {msg_id}")
                    continue
                    
                if not mail_data.get('content'):
                    print(f"No content extracted from message {msg_id}")
                    continue

                # Create document with all required fields
                doc = Document(
                    page_content=(
                        f"Date: {mail_data['metadata']['date']}\n"
                        f"From: {mail_data['metadata']['from']}\n"
                        f"To: {mail_data['metadata']['to']}\n"
                        f"Subject: {mail_data['metadata']['subject']}\n\n"
                        f"{mail_data['content']}"
                    ),
                    metadata={
                        **mail_data['metadata'],
                        'threadId': message['threadId'],  # Ensure threadId is included
                        'processed_timestamp': time.time()
                    }
                )
                documents.append(doc)
            except Exception as e:
                print(f"Error processing message {msg_id}: {str(e)}")
                continue
                
        return documents

    # Process messages in parallel batches
    batch_size = 100  # Gmail API batch limit
    all_documents = []
    tasks = []
    
    for i in range(0, len(messages), batch_size):
        batch_ids = [msg['id'] for msg in messages[i:i + batch_size]]
        tasks.append(process_message_batch(batch_ids))
    
    # Execute all batches concurrently
    batch_results = await asyncio.gather(*tasks)
    
    # Collect successful documents and error counts
    error_count = 0
    for docs in batch_results:
        all_documents.extend(docs)
        error_count += (batch_size - len(docs))

    # Step 3: Bulk insert into ChromaDB with error handling
    successful_imports = 0
    if all_documents:
        try:
            db.add_documents(all_documents)
            successful_imports = len(all_documents)
        except Exception as e:
            print(f"Error during bulk import to ChromaDB: {str(e)}")
            # Fallback to smaller batches if bulk import fails
            for i in range(0, len(all_documents), 50):
                try:
                    batch = all_documents[i:i + 50]
                    db.add_documents(batch)
                    successful_imports += len(batch)
                except Exception as e:
                    print(f"Error importing batch {i}-{i+50}: {str(e)}")

    end_time = time.time()
    processing_time = end_time - start_time
    
    return {
        
        "message": f"Processed {len(all_documents)}/{len(messages)} emails in {processing_time:.2f} seconds",
        "details": {
            "requested": max_emails,
            "processed": len(all_documents),
            "skipped": len(messages) - len(all_documents),
            "processing_time": processing_time,"status": all_documents
        }
    }


@app.post("/query")   
async def query_emails(query: str):
    """Query emails using two-step RAG with dynamic parameter selection"""
    # Step 1: Generate optimized search parameters using Gemini
    optimization_prompt = f"""Analyze the user's query and generate optimal search parameters for email retrieval.
    
    User Query: {query}
    
    Your response should be JSON format with:
    - "search_query": Optimized search query text (focus on key entities/dates/terms)
    - "k_value": Number of documents to retrieve (3-10 based on query complexity)
    Note: if the user mentions today/yesterday/last week, use the appropriate dates and today is {date.today()}
    
    Example Response:
    {{
        "search_query": "project deadline extension meeting notes Q3 2024",
        "k_value": 5
    }}"""
    
    try:
        # Generate and parse optimization response
        optimization_response = model.generate_content(optimization_prompt)
        response_text = optimization_response.text.replace('```json', '').replace('```', '').strip()
        params = json.loads(response_text)
        
        search_query = params.get("search_query", query)
        k_value = min(max(int(params.get("k_value", 5)), 3), 10)  # Clamp between 3-10
        
    except Exception as e:
        # Fallback to defaults if parsing fails
        search_query = query
        k_value = 5
        print(f"Parameter generation failed: {str(e)}")

    # Step 2: Retrieve relevant documents with dynamic parameters
    results = db.similarity_search(search_query, k=k_value)
    
    # Step 3: Generate final answer with context
    context = "\n\n".join([f"Document {i+1}:\n{doc.page_content}" 
                          for i, doc in enumerate(results)])
    
    answer_prompt = f"""You're an email assistant analyzing relevant messages. Use the context to answer naturally.
    
    Context:
    {context}
    
    Original Query: {query}
    
    Instructions:
    1. Acknowledge relevant emails without mentioning "the context"
    2. Highlight key dates/people/decisions
    3. Summarize main points concisely
    4. Quote important numbers/dates verbatim when crucial
    
    Response:"""
    
    final_response = model.generate_content(answer_prompt)
    return {"response": final_response.text,"k":k_value}

@app.get("/date_range_query")
async def query_by_date(start_date: str, end_date: str, query: Optional[str] = None):
    """Query emails within a date range"""
    try:
        start = parser.parse(start_date)
        end = parser.parse(end_date)
        
        # Query ChromaDB and filter by date
        results = db.similarity_search(
            query if query else "",
            k=100  # Get more results initially for filtering
        )
        
        filtered_docs = [
            doc for doc in results
            if start <= parser.parse(doc.metadata['date']) <= end
        ]
        
        if query:
            # Use Gemini to process the filtered results
            context = "\n\n".join([doc.page_content for doc in filtered_docs[:5]])
            prompt = f"""Based on these emails from {start_date} to {end_date}, please answer: {query}"""
            response = model.generate_content(prompt)
            return {"response": response.text}
        
        return {"emails": [doc.metadata for doc in filtered_docs]}
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/upcoming_deadlines")
async def get_deadlines():
    """Extract upcoming deadlines from emails using optimized search"""
    # Step 1: Generate deadline-specific search parameters
    optimization_prompt = """Generate optimal search parameters for finding deadline-related emails.
    Consider synonyms like: due date, submission deadline, final review, closing date.
    Return JSON format with:
    - "search_terms": list of 3-5 most relevant search terms
    - "k_value": number of emails to analyze (10-20)"""
    
    try:
        opt_response = model.generate_content(optimization_prompt)
        params = json.loads(opt_response.text.replace('```json', '').replace('```', '').strip())
        search_terms = params.get("search_terms", ["deadline", "due date", "submission"])
        k_value = min(max(int(params.get("k_value", 15)), 10), 20)
    except Exception as e:
        search_terms = ["deadline", "due date", "submission"]
        k_value = 15

    # Step 2: Retrieve relevant emails
    results = db.similarity_search(" ".join(search_terms), k=k_value)
    
    # Step 3: Structured deadline extraction
    context = "\n\n".join([f"Email {i+1} (ID: {doc.metadata['id']}):\n{doc.page_content}" 
                          for i, doc in enumerate(results)])
    
    extraction_prompt = f"""Analyze these emails and extract upcoming deadlines in JSON format:
    {{
        "deadlines": [
            {{
                "due_date": "YYYY-MM-DD",
                "description": "Brief purpose",
                "email_id": "message ID",
                "confidence": "high/medium/low"
            }}
        ]
    }}

    Context:
    {context}

    Rules:
    1. Include only future dates
    2. Mark confidence based on clarity of deadline
    3. Reject recurring meetings
    4. Prioritize dates in email subjects
    """
    
    try:
        response = model.generate_content(extraction_prompt)
        deadlines = json.loads(response.text.replace('```json', '').replace('```', '').strip())
        return deadlines
    except Exception as e:
        return {"error": "Failed to parse deadlines", "details": str(e)}

@app.get("/important_emails")
async def get_important_emails(days: int, limit: int):
    """Get prioritized emails from last N days with AI analysis"""
    # Step 1: Dynamic importance detection
    optimization_prompt = f"""Given a request for important emails from the last {days} days,
    generate search parameters considering:
    - Urgency indicators
    - Leadership communication
    - Project-critical information
    Return JSON with:
    - "search_terms": list of 3-5 priority terms
    - "k_value": number to retrieve (25-100)"""
    
    try:
        opt_response = model.generate_content(optimization_prompt)
        params = json.loads(opt_response.text.replace('```json', '').replace('```', '').strip())
        search_terms = params.get("search_terms", ["important", "urgent", "priority"])
        k_value = min(max(int(params.get("k_value", 50)), 25), 100)
    except Exception as e:
        search_terms = ["important", "urgent", "priority"]
        k_value = 50

    # Step 2: Retrieve and filter emails
    results = db.similarity_search(" ".join(search_terms), k=k_value)
    cutoff_date = datetime.now(pytz.utc) - timedelta(days=days)
    recent_docs = []
    for doc in results:
        try:
            # Parse email date to timezone-aware datetime
            email_date = parser.parse(doc.metadata['date'])
            
            # Make both datetimes timezone-aware
            if email_date.tzinfo is None:
                email_date = email_date.replace(tzinfo=pytz.utc)
                
            if email_date >= cutoff_date:
                recent_docs.append(doc)
                
            if len(recent_docs) >= limit:
                break
                
        except Exception as e:
            print(f"Error parsing date for email {doc.metadata.get('id')}: {str(e)}")
            continue
    # Step 3: Individual email analysis
    analyzed_emails = []
    for doc in recent_docs:
        analysis_prompt = f"""Analyze this email's importance (1-10 scale):
        From: {doc.metadata['from']}
        Subject: {doc.metadata['subject']}
        Date: {doc.metadata['date']}
        Content: {doc.page_content[:1000]}

        Consider:
        - Urgency level
        - Sender authority
        - Action required
        - Project impact
        - Follow-up needed

        Return JSON:
        {{
            "importance_score": 0-10,
            "reasons": ["list", "of", "key", "factors"],
            "recommended_action": "brief suggestion"
        }}"""
        
        try:
            analysis = model.generate_content(analysis_prompt)
            analysis_data = json.loads(analysis.text.replace('```json', '').replace('```', '').strip())
            analyzed_emails.append({
                "metadata": doc.metadata,
                "summary": doc.page_content[:500],
                "analysis": analysis_data
            })
        except Exception as e:
            analyzed_emails.append({
                "metadata": doc.metadata,
                "error": "Analysis failed"
            })

    return {"important_emails": analyzed_emails}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
