I would like to migrate the data storage and synchronization engine to PowerSync (using Sqlite on the frontend, and Postgres on the backend). Here is a link to the Github repository for you to check the differences between the approaches. 

This is a non trivial task. Let's start by defining some tests that we know will fail at the beginning of this process, but gradually will pass as we complete the exercise. 

--- 

I am migrating local-first note-taking project from a CouchDB + PouchDB to Postgres + PowerSync + Sqlite. I don't have any tests for Pouch+CouchDB - but I'd like to take this opportunity to start with the tests knowing they will fail initially and gradually pass all the tests. 

--- 

I am migrating local-first note-taking project from a CouchDB + PouchDB to Postgres + PowerSync + Sqlite. Besides a user table, below is the json data structure I am currently using for the note/folder synchronization. Let's start by creating the necessary tables.  

--- 

I am migrating local-first note-taking project from a CouchDB + PouchDB to Postgres + PowerSync + Sqlite (WASM). Below is the entirety of the codebase. Given this is a non trivial endeavour, we will need to break it down into smaller tasks. Before we start amending any code, let's start by responding the below persons:

1. What files do you think we will need to modify to accomodate these changes? Please output the entire path for each file. 
2. What changes would you apply to each of these files? 
3. How would you suggest we test that the changes made are working correctly?

Please keep in mind - I do not want to see any code as of yet. I need a blueprint for the changes we will carry out in a future exercise. 

---


