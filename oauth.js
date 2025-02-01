// Auto-resize textarea
const messageTextarea = document.getElementById('message-textarea');
messageTextarea.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = (this.scrollHeight) + 'px';
});

// Show home page by default
document.getElementById('home-page').style.display = 'block';
document.getElementById('message-container').style.display = 'none';

// Handle navigation
document.getElementById('home').addEventListener('click', function() {
  document.getElementById('home-page').style.display = 'block';
  document.getElementById('message-container').style.display = 'none';
});

document.getElementById('loadEmails').addEventListener('click', function() {
  document.getElementById('home-page').style.display = 'none';
  document.getElementById('message-container').style.display = 'block';
});
document.getElementById('labeledGroups').addEventListener('click',function() {
  document.getElementById('home-page').style.display = 'none';
  document.getElementById('message-container').style.display = 'block';
});
function toggleMenu() {
  document.getElementById("menu").classList.toggle("show");
}

// Close menu when clicking outside
const hamburg = document.getElementById("hamburger");
hamburg.addEventListener("click", function(){
  document.getElementById("menu").classList.toggle("show");
})
document.addEventListener("click", function(event) {
  if (!document.querySelector(".header").contains(event.target)) {
    document.getElementById("menu").classList.remove("show");
  }
});
const BACKEND_URL = 'http://localhost:8000';
let syncInterval;

// async function checkAndInitializeDatabase(token) {
//   try {
//     // Check sync status
//     const syncStatus = await fetch(`${BACKEND_URL}/check_sync`, {
//       headers: {
//         'Authorization': `Bearer ${token}`,
//         'Content-Type': 'application/json'
//       }
//     }).then(r => r.json());

//     // Initialize if never synced before
//     if (syncStatus.last_sync === 0) {
//       await fetch(`${BACKEND_URL}/initialize_db`, {
//         method: "POST",
//         headers: {
//           'Authorization': `Bearer ${token}`,
//           'Content-Type': 'application/json'
//         }
//       });
//     }
    
//     // Perform initial sync
//     await syncEmails(token);
    
//     // Set up hourly sync
//     syncInterval = setInterval(() => syncEmails(token), 3600000); // 1 hour
    
//   } catch (error) {
//     console.error('Database initialization failed:', error);
//     throw error;
//   }
// }

// async function syncEmails(token) {
//   try {
//     const response = await fetch(`${BACKEND_URL}/sync_emails`, {
//       method: 'POST',
//       headers: {
//         'Authorization': `Bearer ${token}`,
//         'Content-Type': 'application/json'
//       }
//     });
//     const result = await response.json();
//     console.log('Sync result:', result);
//     return result;
//   } catch (error) {
//     console.error('Sync failed:', error);
//     return {error: 'Sync failed'};
//   }
// }


function showLabeledGroups(token) {
  const mainView = document.getElementById('main-view');
  const messageContainer = document.getElementById('message-container');
  messageContainer.innerHTML = '';

  let init = {
    method: "GET",
    async: true,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
  };

  // Define system-generated labels to exclude
  const systemGeneratedLabels = [
    'CHAT',
    'SENT',
    'INBOX',
    'IMPORTANT',
    'TRASH',
    'DRAFT',
    'SPAM',
    'CATEGORY_FORUMS',
    'CATEGORY_UPDATES',
    'CATEGORY_PERSONAL',
    'CATEGORY_PROMOTIONS',
    'CATEGORY_SOCIAL',
    'STARRED',
    'UNREAD'
  ];

  // Fetch all labels
  fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", init)
    .then(response => response.json())
    .then(labelsData => {
      // Filter out system-generated labels
      window.allLabels = labelsData.labels || [];
      const userLabels = window.allLabels.filter(label => 
        !systemGeneratedLabels.includes(label.id) && 
        !label.id.startsWith('CATEGORY_')
      );
      
      if (userLabels.length === 0) {
        messageContainer.innerHTML = '<div class="no-labels">No custom labels found. Create some labels to see them here.</div>';
        return;
      }

      // Create a card for each user label
      userLabels.forEach(label => {
        const labelCard = document.createElement('div');
        labelCard.className = 'message-card label-card';
        labelCard.innerHTML = `
          <div class="label-name">${label.name}</div>
          <div class="label-count">Loading messages...</div>
        `;

        // Add click handler to show messages with this label
        labelCard.addEventListener('click', () => {
          showMessagesForLabel(label.id, label.name, token);
        });

        messageContainer.appendChild(labelCard);

        // Fetch message count for this label using list request
        fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=${label.id}`, init)
          .then(response => response.json())
          .then(data => {
            const count = data.messages ? data.messages.length : 0;
            labelCard.querySelector('.label-count').textContent = 
              `${count} message${count !== 1 ? 's' : ''}`;
          })
          .catch(error => {
            console.error(`Error fetching count for label ${label.name}:`, error);
            labelCard.querySelector('.label-count').textContent = 'Error loading count';
          });
      });
    })
    .catch(error => {
      console.error("Error fetching labels:", error);
      messageContainer.innerHTML = '<div class="error-message">Error loading labels</div>';
    });
}

function showMessagesForLabel(labelId, labelName, token) {
  const messageContainer = document.getElementById('message-container');
  messageContainer.innerHTML = `
    <div class="label-header">
      <button class="back-to-labels">← Back to Labels</button>
      <h2>Messages with label: ${labelName}</h2>
    </div>
  `;

  const backButton = messageContainer.querySelector('.back-to-labels');
  backButton.addEventListener('click', () => showLabeledGroups(token));

  let init = {
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
  };

  // Fetch messages with this label
  fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=${labelId}`, init)
    .then(response => response.json())
    .then(data => {
      if (data.messages && data.messages.length > 0) {
        const messagePromises = data.messages.map(message =>
          fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`, init)
            .then(response => response.json())
        );

        Promise.all(messagePromises)
          .then(messages => {
            messages.sort((a, b) => b.internalDate - a.internalDate); // Sort by date, newest first
            messages.forEach(email => {
              const subject = email.payload.headers.find(
                header => header.name === "Subject"
              )?.value || "No Subject";
              
              const from = email.payload.headers.find(
                header => header.name === "From"
              )?.value || "Unknown Sender";

              let body = "No Body Found";
              if (email.payload.body?.data) {
                body = decodeBase64(email.payload.body.data);
              } else if (email.payload.parts) {
                const part = email.payload.parts.find(p => p.mimeType === 'text/plain');
                if (part && part.body?.data) {
                  body = decodeBase64(part.body.data);
                } else {
                  const htmlPart = email.payload.parts.find(p => p.mimeType === 'text/html');
                  if (htmlPart && htmlPart.body?.data) {
                    body = decodeBase64(htmlPart.body.data);
                  }
                }
              }

              const date = new Date(parseInt(email.internalDate));
              const formattedDate = date.toLocaleString();

              const messageDiv = document.createElement("div");
              messageDiv.className = "message-card";
              messageDiv.innerHTML = `
                <div class="message-subject">${subject}</div>
                <div class="message-sender">${from}</div>
                <div class="message-date">${formattedDate}</div>
                <div class="message-preview">${truncateText(body, 100)}</div>
              `;

              // Add click handler to show full email detail
              messageDiv.addEventListener("click", () => {
                const mainView= document.getElementById('main-view');
                const existingDetail = document.getElementById('email-detail');
                if (existingDetail) {
                  existingDetail.remove();
                }
                showEmailDetail(subject, from, body, formattedDate, email.id, email.labelIds || [], window.allLabels, token);
                mainView.style.display='none';
              });

              messageContainer.appendChild(messageDiv);
            });
          });
      } else {
        messageContainer.innerHTML += '<div class="no-messages">No messages found with this label</div>';
      }
    })
    .catch(error => {
      console.error("Error fetching messages:", error);
      messageContainer.innerHTML += '<div class="error-message">Error loading messages</div>';
    });
}
window.onload = function() {
  const loadEmailsBtn = document.querySelector('#loadEmails');
  const labeledGroupsBtn = document.querySelector('#labeledGroups');
  const homeBtn = document.querySelector('#home');
  const startBtn = document.querySelector('#start');
  // const textArea=document.querySelector('#message-textarea')
  // const sendButton=document.querySelector('#send-button')
  const deadBtn= document.querySelector('#deadlines')
  
  // sendButton.addEventListener('click',()=>{
  //   let init = {
  //     method: "POST",
  //     async: true
  //   };
  //   sendButton.disabled=true;
  //   fetch("http://localhost:8000/query?query="+textArea.textContent, init)
  //     .then((response) => response.json())
  //     .then((data) => {
  //       console.log(data);
  //       sendButton.disabled=false;
  //     })
  //     .catch((error) => {
  //       console.error("Error:", error);
  //       sendButton.disabled=false;
  //   });
  // });
  deadBtn.addEventListener('click', () => {
    // Disable button while fetching
    const messageContainer=document.querySelector("#message-container")
    deadBtn.disabled = true;
    
    let init = {
        method: "GET",
        async: true
    };

    fetch("http://localhost:8000/upcoming_deadlines", init)
        .then((response) => response.json())
        .then((data) => {
          homeBtn.disabled=false;
          labeledGroupsBtn.disabled=false;
          loadEmailsBtn.disabled=false;
            // If no deadlines, show message and return
            if (!data.deadlines || data.deadlines.length === 0) {
                messageContainer.innerHTML = "Whoohoo! No deadlines!";
                return;
            }

            // Create table HTML
            messageContainer.innerHTML = `
                <table id="deadlineTable">
                    <thead>
                        <tr>
                            <th>Due Date</th>
                            <th>Description</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody id="tableBody"></tbody>
                </table>
            `;

            // Get unique deadlines
            const uniqueDeadlines = data.deadlines.reduce((unique, deadline) => {
                if (!unique.has(deadline.email_id)) {
                    unique.set(deadline.email_id, deadline);
                }
                return unique;
            }, new Map());

            // Format date function
            const formatDate = (dateStr) => {
                const date = new Date(dateStr);
                return date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            };

            // Add to calendar function
            const addToCalendar = async (deadline) => {
              try {
                // Get Google OAuth token
                chrome.identity.getAuthToken({ interactive: true }, async function (token) {
                  if (!token) {
                    console.error("Failed to obtain token.");
                    alert("Could not authenticate. Please check permissions.");
                    return;
                  }
      
                  // Create event object
                  const event = {
                    summary: deadline.description,
                    description: `Deadline for: ${deadline.description}`,
                    start: {
                      date: deadline.due_date, // Use the due date as the start date
                      timeZone: 'UTC',
                    },
                    end: {
                      date: deadline.due_date, // Use the due date as the end date
                      timeZone: 'UTC',
                    },
                    reminders: {
                      useDefault: true,
                    },
                  };
      
                  // Insert event into Google Calendar
                  const calendarResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${token}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(event),
                  });
      
                  if (!calendarResponse.ok) {
                    throw new Error(`Failed to create event: ${calendarResponse}`);
                  }
      
                  const eventData = await calendarResponse.json();
                  alert(`Event added to your calendar!`);
                });
              } catch (error) {
                console.error("Error creating calendar event:", error);
                alert("Failed to create calendar event. Please try again.");
              }
            };

            // Get table body and populate it
            const tableBody = document.getElementById('tableBody');
            Array.from(uniqueDeadlines.values()).forEach(deadline => {
                const row = document.createElement('tr');
                
                const dateCell = document.createElement('td');
                dateCell.textContent = formatDate(deadline.due_date);
                
                const descCell = document.createElement('td');
                descCell.textContent = deadline.description;
                
                const actionCell = document.createElement('td');
                const calendarBtn = document.createElement('button');
                calendarBtn.className = 'calendar-btn';
                calendarBtn.textContent = 'Add to Calendar';
                calendarBtn.onclick = () => addToCalendar(deadline);
                actionCell.appendChild(calendarBtn);

                row.appendChild(dateCell);
                row.appendChild(descCell);
                row.appendChild(actionCell);
                tableBody.appendChild(row);
            });
        })
        .catch((error) => {
            console.error("Error:", error);
            homeBtn.disabled=false;
            labeledGroupsBtn.disabled=false;
            loadEmailsBtn.disabled=false;
            deadBtn.disabled=false;
            messageContainer.innerHTML = "Error loading deadlines. Please try again.";
        });
});

  const messageTextarea = document.getElementById('message-textarea');
  const sendButton = document.getElementById('send-button');
  const chatContainer = document.getElementById('chat-container');

    // Function to add a new message to the chat
  function addMessage(message, isUser = true) {
      const messageElement = document.createElement('div');
      messageElement.className = `chat-message ${isUser ? 'user' : 'assistant'}`;
      messageElement.textContent = message;
      chatContainer.appendChild(messageElement);

      // Clear textarea after sending message
      if (isUser) {
          messageTextarea.value = '';
      }

      // Auto-scroll to the bottom
      messageElement.scrollIntoView({ behavior: 'smooth' });
  }

  // Function to handle sending messages
  function handleSendMessage() {
      const message = messageTextarea.value.trim();
      sendButton.disabled=true
      if (message) {
          // Add user message
          addMessage(message, true);
          let init = {
              method: "POST",
              async: true
            };
            sendButton.disabled=true;
            fetch("http://localhost:8000/query?query="+message, init)
              .then((response) => response.json())
              .then((data) => {
                console.log(data);
                addMessage(data.response,false);
                sendButton.disabled=false;
              })
              .catch((error) => {
                console.error("Error:", error);
                addMessage("Something went wrong!",false)
                sendButton.disabled=false;
            });
          // Simulate assistant response (you can replace this with actual API call)
          
      }
  }

  // Click event for send button
  sendButton.addEventListener('click', handleSendMessage);

  // Enter key event for textarea (Send on Enter, new line on Shift+Enter)
  messageTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault(); // Prevent new line
          handleSendMessage();
      }
  });



  startBtn.addEventListener('click',function(){
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if(!token) {
        console.error("Failed to obtain token.");
        alert("Could not authenticate. Please check permissions.");
        return;
      }
      let init = {
        method: "POST",
        async: true,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
      };
      startBtn.disabled=true;
      fetch("http://localhost:8000/initialize_db?max_emails=100", init)
      .then((response) => response.json())
      .then((data) => {
        console.log(data);
        startBtn.disabled=false;
      })
      .catch((error) => {
        console.error("Error:", error);
        startBtn.disabled=false;
    });
    });
  });
  // chrome.identity.getAuthToken({interactive: false}, async (token) => {
  //   if (token) {
  //     try {
  //       // Automatic initialization and sync
  //       await checkAndInitializeDatabase(token);
  //       labeledGroupsBtn.style.display = 'block';
        
  //       // Set up labeled groups button
  //       labeledGroupsBtn.addEventListener("click", () => {
  //         showLabeledGroups(token);
  //       });
        
  //       // Sync whenever extension is opened
  //       await syncEmails(token);
        
  //     } catch (error) {
  //       loadEmailsBtn.style.display = 'block';
  //     }
  //   } else {
  //     loadEmailsBtn.style.display = 'block';
  //   }
  // });

  homeBtn.addEventListener('click', function() {
    document.getElementById('home-page').style.display = 'block';
    document.getElementById('message-container').style.display = 'none';
    this.disabled = true;
    loadEmailsBtn.disabled = false;
    labeledGroupsBtn.disabled = false;
    deadBtn.disabled=false;
  });
  loadEmailsBtn.addEventListener("click", function() {
    this.disabled = true;
    homeBtn.disabled = false;
    labeledGroupsBtn.disabled=false;
    deadBtn.disabled=false;
    chrome.identity.getAuthToken({ interactive: true }, async function(token) {
      if (!token) {
        console.error("Failed to obtain token.");
        loadEmailsBtn.disabled=false;
        alert("Could not authenticate. Please check permissions.");
        return;
      }
      // try {
      //   await checkAndInitializeDatabase(token);
      //   loadEmailsBtn.disabled=true;
      //   labeledGroupsBtn.disabled=false;
      //   homeBtn.disabled=false;
      // } catch (error) {
      //   alert("Initialization failed. Please try again");
      // }

      let init = {
        method: "GET",
        async: true,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
      };

      fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", init)
        .then(response => response.json())
        .then(labelsData => {
          const labels = labelsData.labels || [];
          
          return fetch(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&orderBy=internalDate&q=in:inbox",
            init
          ).then(response => {
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json().then(data => ({ data, labels }));
          });
        })
        .then(({ data, labels }) => {
          if (data.messages) {
            const messageContainer = document.getElementById("message-container");
            messageContainer.innerHTML = "";

            const messagePromises = data.messages.map(message => 
              fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
                init
              ).then(response => response.json())
            );

            Promise.all(messagePromises)
              .then(messages => {
                messages.sort((a, b) => b.internalDate - a.internalDate);
                messages.forEach(email => {
                  const subject = email.payload.headers.find(
                    header => header.name === "Subject"
                  )?.value || "No Subject";
                  
                  const from = email.payload.headers.find(
                    header => header.name === "From"
                  )?.value || "Unknown Sender";

                  let body = "No Body Found";
                  if (email.payload.body?.data) {
                    body = decodeBase64(email.payload.body.data);
                  } else if (email.payload.parts) {
                    const part = email.payload.parts.find(p => p.mimeType === 'text/plain');
                    if (part && part.body?.data) {
                      body = decodeBase64(part.body.data);
                    } else {
                      const htmlPart = email.payload.parts.find(p => p.mimeType === 'text/html');
                      if (htmlPart && htmlPart.body?.data) {
                        body = decodeBase64(htmlPart.body.data);
                      }
                    }
                  }

                  const date = new Date(parseInt(email.internalDate));
                  const formattedDate = date.toLocaleString();

                  const messageDiv = document.createElement("div");
                  messageDiv.className = "message-card";
                  
                  messageDiv.innerHTML = `
                    <div class="message-sender"><strong>${from}</strong></div>
                    <div class="message-subject"><strong>Subject:</strong> ${subject}</div>
                    <div class="message-preview">${truncateText(body, 100)}</div>
                  `;

                  messageDiv.addEventListener("click", () => {
                    showEmailDetail(subject, from, body, formattedDate, email.id, email.labelIds || [], labels, token);
                  });

                  messageContainer.appendChild(messageDiv);
                });
              });
          } else {
            console.log("No messages found.");
            alert("No emails found.");
          }
        })
        .catch((error) => {
          console.error("Error fetching data:", error);
          if (error.message.includes("403")) {
            alert("Permission denied. Please ensure Gmail API access is granted.");
          }
        });
    });
  });
  // window.addEventListener('beforeunload',()=>{
  //   if(syncInterval) clearInterval(syncInterval);
  // });
  labeledGroupsBtn.addEventListener("click",function(){
    this.disabled=true;
    loadEmailsBtn.disabled=false;
    homeBtn.disabled=false;
    deadBtn.disabled=false;
    chrome.identity.getAuthToken({interactive: true},function(token){
      if(!token){
        console.error("Failed to obtain token.");
        labeledGroupsBtn.disabled = false;
        loadEmailsBtn.disabled = false;
        homeBtn.disabled = false;
        deadBtn.disabled=false;
        alert("Could not authenticate. Please check permissions.");
        return;
      }
      showLabeledGroups(token);
      loadEmailsBtn.disabled=false;
    });
  });
};

function showEmailDetail(subject, from, body, date, messageId, currentLabelIds, allLabels, token) {
  const existingDetail = document.getElementById("email-detail");
  if (existingDetail) {
    existingDetail.remove();
  }
  const detailDiv = document.createElement("div");
  const mainView = document.getElementById('main-view');
  detailDiv.id = "email-detail";

  const currentLabels = allLabels
    .filter(label => currentLabelIds.includes(label.id))
    .map(label => label.name);
  const systemGeneratedLabels = ['CHAT','SENT','INBOX','IMPORTANT','TRASH','DRAFT','SPAM','CATEGORY_FORUMS','CATEGORY_UPDATES','CATEGORY_PERSONAL','CATEGORY_PROMOTIONS','CATEGORY_SOCIAL','STARRED','UNREAD'];
  const applied = Array.from(new Set([...currentLabels,...systemGeneratedLabels]));
  detailDiv.innerHTML =`<button class="back-button" id="backButton" style="margin-bottom: 15px;">Back to Inbox</button>

<h2 style="margin-bottom: 10px;">${subject}</h2>

<p style="margin-bottom: 5px;"><strong>From:</strong> ${from}</p>
<p style="margin-bottom: 15px;"><strong>Date:</strong> ${date}</p>

<div class="label-section" style="margin-bottom: 15px;">
    <strong>Current Labels:</strong> ${currentLabels.join(', ') || 'None'}
</div>

<div class="email-content" style="margin-bottom: 20px;">
    ${body}
</div>

<div class="response-section" style="margin-bottom: 20px; background-color: #f9f9f9; padding: 6px; padding-top: 1px;">
    <h3 style="margin-bottom: 10px;">Generate Response</h3>
    <div class="reply-section" style="display: flex; align-items: center; gap: 10px;">
        <textarea id="userReply" placeholder="Write your brief response here..." 
            style="width: 100%; min-height: 50px; padding: 12px; border: 0px solid #e0e0e0; border-radius: 4px; font-family: Arial, sans-serif; font-size: 14px; resize: none; margin-bottom: 9px; box-sizing: border-box;"></textarea>
        <button id="generateReply" style="padding: 10px; height: fit-content; border-radius: 50px;">
            Generate
        </button>
    </div>
    <div id="generatedResponse" style="display: none; margin-top: 10px;">
        <strong>Generated Response:</strong>
        <div style="display: flex; align-items: center; gap: 10px;">
        <div id="responseText" contenteditable="true" style="border: 1px solid #ddd; padding: 10px; margin-top: 5px;"></div>
        <button id="send_email" style="padding: 15px; padding-top: 10px; padding-bottom: 10px; height: fit-content; border-radius: 50px;">Send</button></div>
    </div>
</div>

<div class="label-section" style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
    <h3 style="margin-bottom: 15px;">Label Management</h3>
    
    <div style="margin-bottom: 15px;">
        <button id="suggestLabels" style="padding: 10px;">Suggest and Add Labels</button>
        <div id="suggestedLabels" style="margin-top: 10px;"></div>
    </div>
    <div style="display: flex; gap: 10px; margin-bottom: 15px; align-items: center;">
        <select id="labelSelect" style="flex-grow: 1; padding: 8px;">
            ${allLabels.map(label => `<option value="${label.id}">${label.name}</option>`).join('')}
        </select>
        <button id="addLabel" style="padding: 10px;">Add Label</button>
    </div>
    
    <div style="display: flex; gap: 10px;">
        <input type="text" id="customLabel" placeholder="Enter custom label" 
            style="flex-grow: 1; padding: 8px;">
        <button id="createLabel" style="padding: 10px;">Create & Add Label</button>
    </div>
</div>`
  document.body.appendChild(detailDiv),
  detailDiv.classList.add('visible');
  mainView.style.display = 'none';
  const handleBack = () => {
    detailDiv.classList.remove('visible');
    mainView.style.display = 'block';
    setTimeout(() => {
      detailDiv.remove();
    }, 300);
  };
  const backButton = document.getElementById('backButton');
  backButton.addEventListener('click', handleBack);

  document.getElementById("send_email").addEventListener("click",async () => {
    const replyHTML = document.getElementById('responseText').innerHTML;
    let formattedHTML = replyHTML.replace(/<br\s*\/?>/gi, "\n");
    let parser = new DOMParser();
    let doc = parser.parseFromString(formattedHTML, "text/html"); 
    let reply = doc.body.textContent.trim();
    if (!reply) {
      alert("Reply cannot be empty!");
      return;
    }
    chrome.identity.getAuthToken({ interactive: true }, async function(token) {
      if (!token) {
        console.error("Failed to obtain token.");
        return;
      }
      const emailContent = [
        `To: ${from}`,
        "Subject: Re: " + subject,
        "Content-Type: text/plain; charset=\"UTF-8\"",
        "MIME-Version: 1.0",
        "",
        reply
      ].join("\n");
      const base64EncodedEmail = btoa(emailContent).replace(/\+/g, '-').replace(/\//g, '_');
      const sendEmailUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
      const requestBody = {
        raw: base64EncodedEmail
      };
      try {
        const response = await fetch(sendEmailUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });
  
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
  
        alert("Email sent successfully!");
      } catch (error) {
        console.error("Error sending email:", error);
        alert("Failed to send email. Please try again.");
      }
    });
  });
  document.getElementById("generateReply").addEventListener("click", async () => {
    const userReply = document.getElementById("userReply").value;
    if (!userReply.trim()) {
      alert("Please enter your brief response first.");
      return;
    }

    const responseDiv = document.getElementById("generatedResponse");
    const responseText = document.getElementById("responseText");
    
    responseDiv.style.display = "block";
    responseText.innerHTML = "Generating response...";

    try {
      const GEMINI_API_KEY = "AIzaSyCBDgkTZBU-UKf19GouSm3e2YQ45MGvozE";
      const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${GEMINI_API_KEY}`;
      
      const prompt = `
        Build a formal and professional reply to an email based on the following inputs:
        Original Mail: ${body}
        Answer to Be Conveyed: ${userReply}
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

      const result = await response.json();
      const generatedReply = result.candidates[0].content.parts[0].text;
      responseText.innerHTML = generatedReply.replace(/\n/g, '<br>');
    } catch (error) {
      console.error("Error generating response:", error);
      responseText.innerHTML = "Error generating response. Please try again.";
    }
  });

  // Add event listeners for label management
  document.getElementById("suggestLabels").addEventListener("click", async () => {
    const suggestedLabelsDiv = document.getElementById("suggestedLabels");
    suggestedLabelsDiv.innerHTML = "Analyzing email content...";

    try {
      const GEMINI_API_KEY = "AIzaSyCBDgkTZBU-UKf19GouSm3e2YQ45MGvozE";
      const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${GEMINI_API_KEY}`;
      const a=Array.from(allLabels.map(l=>l.name));
      let difference = a.filter(label => !applied.includes(label));
      if(difference.length === 0){
        difference=["Nothing"];
      }
      const prompt = "You are an intelligent email categorization assistant.Your task is to analyze the provided email content and select up to two applicable labels from a list of categories provided.These are labels that have not been previously applied to the email.If you determine that no additional labels are necessary, you may indicate that no further labels are required.*Instructions:* 1.*Input Format:* - Email Content:"+body+"- Applicable Labels:"+difference.join(', ')+"2.*Processing Steps:* - Read the email content carefully.- Review the list of applicable labels.- Identify the context, key themes, and actionable items within the email.- Match the identified themes with the applicable labels. 3.*Output Format:* - If applicable labels are found, return a list of at most two most relevant labels.- If no additional labels are applicable, return a message indicating that no further labels are required.*Example Output:* - Selected Labels: [Label 1, Label 2]- Or: Selected Label: [Label]- Or: 'No further labels are required.' ";

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

      const result = await response.json();
      const suggestions = result.candidates[0].content.parts[0].text.trim();
      
        suggestedLabelsDiv.innerHTML = `
        <div style="margin-top: 10px; padding: 10px; background-color: #f0f0f0; border-radius: 4px;">
          <strong></strong> ${suggestions}
        </div>
      `;
    } catch (error) {
      console.error("Error suggesting labels:", error);
      suggestedLabelsDiv.innerHTML = "Error generating label suggestions.";
    }
  });

  // Handle adding existing labels
  document.getElementById("addLabel").addEventListener("click", async () => {
    const labelId = document.getElementById("labelSelect").value;
    try {
      await modifyLabels(messageId, token, [labelId], []);
      alert("Label added successfully!");
      // Refresh the email detail view
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      const emailData = await response.json();
      showEmailDetail(subject, from, body, date, messageId, emailData.labelIds, allLabels, token);
    } catch (error) {
      console.error("Error adding label:", error);
      alert("Failed to add label");
    }
  });

  // Handle creating and adding new labels
  document.getElementById("createLabel").addEventListener("click", async () => {
    const newLabelName = document.getElementById("customLabel").value.trim();
    if (!newLabelName) {
      alert("Please enter a label name");
      return;
    }

    try {
      // Create new label
      const response = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/labels",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: newLabelName,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
          }),
        }
      );

      const newLabel = await response.json();
      
      // Add the new label to the message
      await modifyLabels(messageId, token, [newLabel.id], []);
      alert("New label created and added successfully!");
      
      // Refresh the email detail view
      const emailResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      const emailData = await emailResponse.json();
      
      // Refresh labels list
      const labelsResponse = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/labels",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      const labelsData = await labelsResponse.json();
      
      showEmailDetail(subject, from, body, date, messageId, emailData.labelIds, labelsData.labels, token);
    } catch (error) {
      console.error("Error creating/adding label:", error);
      alert("Failed to create/add label");
    }
  });
}

async function modifyLabels(messageId, token, addLabelIds, removeLabelIds) {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addLabelIds,
        removeLabelIds,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to modify labels: ${response.statusText}`);
  }
  return response.json();
}

// Existing helper functions
function decodeBase64(data) {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(base64)));
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substr(0, maxLength) + '...';
}