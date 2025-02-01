# Chimera mail

Chimera mail is a chrome extension which allows users to automatically sort mails, obtain deadlines, send enhanced replies based on context and ask questions on your mail corpus!
```bash
git clone https://github.com/NidhishDoshi/Chimera_Mail.git
```

## Installation

Preferably set up a python virtual env before doing this
```bash
pip install -r requirements.txt
```
If this doesnt run you'll have to automatically run pip install <package-name> for each 

## Usage

Go to chrome://extensions/ -> Enable developer options -> Load Unpacked -> Select the google_Auth dir and upload it. This will load the extension locally.

Go to your Google OAuth page, enable Gmail and Google Calendar API's, add all available scopes for Gmail and Calendar for your project and then create two OAuth clients:

1. A Chrome extension client with extension ID obtained from the chrome://extensions/ page: the client ID obtained from here must be replaced in google_Auth/manifest.json.

2. A web application OAuth client with:
   - Allowed JavaScript origins: http://localhost
   - Authorized redirect URI's: https://<extension_id>.chromiumapp.org/oauth2, http://localhost:8000/oauth2/callback

Creating this generates two IDs: client_id and client_secret, which need to be added to app.py.

Also, add the authenticated users' email addresses for your application as it is still in the testing stage. Only these emails can be used with the extension.

On a separate terminal, run the following
```bash
uvicorn app:app --reload
```
