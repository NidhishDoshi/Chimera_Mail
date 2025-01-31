setInterval(() => {
    const newMailForm = document.querySelectorAll("div[g_editable]");
    newMailForm.forEach((current)=> {
      if(current.parentNode && current.parentNode.querySelector(".magic-button-container") == null) {
        insertMagicButton(current);
        current.parentNode.querySelector(".magic-button-container").addEventListener("mousedown", async () => {
          const button = current.parentNode.querySelector(".magic-button-icon");
          if(button.classList.contains("error")) {
            button.classList.remove("error")
          }
          const receivedEmail = extractReceivedEmailContent();
          if (!receivedEmail) {
            button.classList.add("error");
            alert("Cannot find the original email content. Please ensure you are in a reply view.");
            return;
          }
          let userSelection = window.getSelection();
          const emailContent = userSelection.toString() || null;
          if (emailContent == null || emailContent.length < 1 || emailContent.replaceAll("\n","") == "") {
            button.classList.add("error");
            alert("Cannot work with empty email. Highlight desired text.")
            return;
          }
          const selectedRange = userSelection.getRangeAt(0)
          selectedRange.deleteContents();
          newNode = document.createElement("div");
          newNode.classList.add("lds-dual-ring");
          selectedRange.insertNode(newNode);
  
          try {
            const processedEmailPayload = await fetchFromOpenai(receivedEmail, emailContent);
            let processedEmailContent = processedEmailPayload.candidates[0].content.parts[0].text;
            newNode = document.createElement("div");
            newNode.classList.add("formalizeit-insertion")
            newNode.innerText = processedEmailContent;
            current.parentNode.querySelector(".lds-dual-ring").remove();
            selectedRange.insertNode(newNode);
          } catch (error) {
              button.classList.add("error");
              console.log("Something went wrong while talking to OpenAI. Check your OpenAI API key and related settings.")
              console.log(error);
              newNode = document.createElement("div");
              newNode.innerText = emailContent;
              current.parentNode.querySelector(".lds-dual-ring").remove();
              selectedRange.insertNode(newNode);
          }  
      })
    }
    })
  
  }, 1000)
  
  
  async function fetchFromOpenai(original_mail, inputData) {
    const GEMINI_API_KEY="<Enter your GEMINI_API_KEY>";
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${GEMINI_API_KEY}`;
    const emailBody = inputData;
    
    if (!emailBody || emailBody == "" || emailBody.replaceAll("\n","") == ""){
      console.log("Email blank");
      return null
    }
    const prompt = `
          Build a formal and professional reply to an email based on the following inputs:
          Original Mail: ${original_mail}}
          Answer to Be Conveyed: ${emailBody}
          Your task is to craft a response that is polite, professional, and aligns with the tone and intent
          of the original mail. Ensure the reply incorporates the provided answer seamlessly and maintains
          a word count between 100 and 150 words. Structure the response with appropriate salutations, a 
          well-organized body, and a courteous closing.
        `;
    const response = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });
  
    const data = await response.json();
    return data;
  }
  function insertMagicButton(element) {
    const buttonTemplate = `
    <div class="magic-button-container">
      <svg class="magic-button-icon" id="magic-button" "xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <title>Enhance Your Mail</title>
        <path fill="currentColor" path d="M7.5,5.6L5,7L6.4,4.5L5,2L7.5,3.4L10,2L8.6,4.5L10,7L7.5,5.6M19.5,15.4L22,14L20.6,16.5L22,19L19.5,17.6L17,19L18.4,16.5L17,14L19.5,15.4M22,2L20.6,4.5L22,7L19.5,5.6L17,7L18.4,4.5L17,2L19.5,3.4L22,2M13.34,12.78L15.78,10.34L13.66,8.22L11.22,10.66L13.34,12.78M14.37,7.29L16.71,9.63C17.1,10 17.1,10.65 16.71,11.04L5.04,22.71C4.65,23.1 4,23.1 3.63,22.71L1.29,20.37C0.9,20 0.9,19.35 1.29,18.96L12.96,7.29C13.35,6.9 14,6.9 14.37,7.29Z" />
      </svg>
    </div>
    `
    element.insertAdjacentHTML("beforebegin", buttonTemplate);
  }
  function extractReceivedEmailContent() {
    try {
      const messageContainers = document.querySelectorAll('div[data-message-id]');
      
      if (!messageContainers.length) {
        console.log("No message containers found");
        return null;
      }
      const lastMessageContainer = messageContainers[messageContainers.length - 1];
      const contentSelectors = [
        'div[data-smartmail]',
        'div.a3s.aiL',
        'div.gmail_quote',
        'blockquote.gmail_quote',
        'div.msg',
        'div.ii.gt',
        'div[dir="ltr"]',
        'div[role="textbox"]'
      ];
  
      let emailContent = '';
      let foundContent = false;
      const cleanText = (text) => {
        return text
          .replace(/[\n\s]+/g, ' ')
          .replace(/On [A-Za-z]{3}, [A-Za-z]{3} \d{1,2}, \d{4}.*wrote:/, '')
          .replace(/On \d{1,2}\/\d{1,2}\/\d{2,4}.*wrote:/, '')
          .trim();
      };
      const processNode = (node) => {
        if (!node || (node.style && node.style.display === 'none')) return '';
        if (node.classList && 
           (node.classList.contains('gmail_signature') || 
            node.classList.contains('signature'))) return '';
  
        let content = '';
        if (node.nodeType === Node.TEXT_NODE) {
          content += node.textContent;
        }
        else if (node.nodeType === Node.ELEMENT_NODE) {
          if (['DIV', 'P', 'BR', 'TR'].includes(node.tagName)) {
            content += '\n';
          }
          for (const child of node.childNodes) {
            content += processNode(child);
          }
        }
        return content;
      };
      for (const selector of contentSelectors) {
        const elements = lastMessageContainer.querySelectorAll(selector);
        for (const element of elements) {
          const content = cleanText(processNode(element));
          if (content && content.length > 20) {
            emailContent = content;
            foundContent = true;
            break;
          }
        }
        if (foundContent) break;
      }
      if (!foundContent) {
        emailContent = cleanText(processNode(lastMessageContainer));
      }
      emailContent = emailContent
        .replace(/^\s+|\s+$/g, '')
        .replace(/[\n\s]+/g, ' ')
        .trim();
      console.log("Found email content length:", emailContent.length);
      console.log("First 100 chars:", emailContent.substring(0, 100));
      return emailContent || null;
    } catch (error) {
      console.error("Error extracting email content:", error);
      return null;
    }
  }

  function extractEmailContent(composeArea) {
    let emailContent = '';
    const processNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        emailContent += node.textContent.trim() + ' ';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BLOCKQUOTE') {
          emailContent += '\n\nQuoted message:\n';
        }
        node.childNodes.forEach(processNode);
        if (['DIV', 'P', 'BR', 'BLOCKQUOTE'].includes(node.tagName)) {
          emailContent += '\n';
        }
      }
    };
    composeArea.childNodes.forEach(processNode);
    return emailContent.replace(/\s+/g, ' ').trim();
  }
