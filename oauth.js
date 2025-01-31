window.onload = function() {
  const loadEmailsBtn = document.querySelector('#loadEmails');
  const labeledGroupsBtn = document.querySelector('#labeledGroups');
  const homeBtn = document.querySelector('#home');
  homeBtn.addEventListener('click', function() {
    document.getElementById('home-page').style.display = 'block';
    document.getElementById('message-container').style.display = 'none';
    this.disabled = true;
    loadEmailsBtn.disabled = false;
    labeledGroupsBtn.disabled = false;
  });
  loadEmailsBtn.addEventListener("click", function() {
    this.disabled = true;
    homeBtn.disabled = false;
    labeledGroupsBtn.disabled=false;
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if (!token) {
        console.error("Failed to obtain token.");
        loadEmailsBtn.disabled=false;
        alert("Could not authenticate. Please check permissions.");
        return;
      }

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
                  console.log(email);
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
};