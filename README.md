# Pretty Neat Notes
A simple self-hostable markdown editor, heavily inspired by StackEdit. 

## Features
- Simple markdown formatting including text formatting, table insertion, and list creation 
- Workspace synchronization using CouchDB and PouchDB
- Stackedit compatible import and export
- Multi-level folder support
- Workspace and local document search
- Print to PDF 
- Self-hostable with minimal configuration

## Tech Stack
### Frontend 
- Vue 3 
- Markdown-it
- PouchDB 

### Backend
- CouchDB 
- Docker compose
- NodeJS signup container
- CouchDB initial configuration container

## Getting Started
### Prerequisites
1. Docker & Docker Compose
2. NodeJS 18.0+

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