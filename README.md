# Chimera mail

Chimera mail is a chrome extension which allows users to automatically sort mails, obtain deadlines, send enhanced replies based on context and ask questions on your mail corpus!
```bash
git clone <url>
```

## Installation

Preferably set up a python virtual env before doing this
```bash
pip install -r requirements.txt
```
If this doesnt run you'll have to automatically run pip install <package-name> for each 

## Usage

Go to chrome://extensions/ -> Enable developer options -> Load Unpacked -> Select the google_Aith dir and upload it. This will load the entension locally.
Go to your google Oauth page, enable Gmail and Google calendar api's,add all available scopes for gmail and calendar for your project and then , create two OAuth clients: A chrome extension client with extension id obtained from the chrome://extensions/ page: the client id obtained from here must be replaced in google_Auth/manifest.json.Then 
create a web application OAuth client with Allowed Javascript origins: http://localhost , Authorized redirect URI's : https://<extension_id>.chromiumapp.org/oauth2, http://localhost:8000/oauth2/callback: creating this makes two ids: client_id and client_secret which needs to be added to app.py.


On a separate terminal, run the following
```bash
uvicorn app:app --reload
```
