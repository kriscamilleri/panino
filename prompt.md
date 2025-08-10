We're building a markdown note taking app. Today we're moving the image/file blob storage out of the sqlite db and into a bind mount mapped path. This would keep our SQLite dbs from becoming painfully slow to load on the web. Let's keep the relative paths stored in the sqlite db. Output any new or amended files in their entirety. 

