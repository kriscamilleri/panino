# Pretty Neat Notes
A simple self-hostable markdown editor, heavily inspired by StackEdit. 

## Features
- Simple markdown editor and renderer
- Shortcuts for text formatting, table insertion, and list creation 
- Workspace synchronization using CouchDB and PouchDB
- Stackedit compatible import and export
- Multi-level folder support
- Workspace and local document search
- Print to PDF 
- Self-hostable with minimal configuration
- Supports multiple user accounts
- Embedded image upload support

## Tech Stack
### Frontend 
- Vue 3 
- Markdown-it
- PouchDB 

### Backend
- CouchDB 
- NodeJS service containers
- CouchDB initial configuration container

## Getting Started
### Prerequisites
1. Docker & Docker Compose

### Environment Variables
Create a .env file in the root directory of the project with the below properties. Don't forget to change the admin username and password.
```
COUCHDB_USER=admin
COUCHDB_PASSWORD=password
COUCHDB_URL=http://couchdb:5984
COUCHDB_HOST=couchdb
```

### Production
1. Create .env file in the root folder of the project with the above variables.
2. Spin up the containers with the below command.
```
docker compose up
```

### Development
1. Create .env file in the root folder of the project with the above variables.
2. Spin up the containers with the below command.
```
docker-compose -f docker-compose.dev.yml up --build
```

#### Frontend Development
**OPTIONAL:** For a faster frontend development experience, comment out the frontend section of the compose and run the below commands within the /frontend folder.
> ```
> npm i
> npm run dev
> ```