import { Schema, Table, column } from '@powersync/web';

// Define tables using PowerSync's Table class
const users = new Table({
    email: column.text,
    created_at: column.text
});

const folders = new Table({
    user_id: column.text,
    name: column.text,
    parent_id: column.text,
    created_at: column.text
});

const notes = new Table({
    user_id: column.text,
    folder_id: column.text,
    title: column.text,
    content: column.text,
    created_at: column.text,
    updated_at: column.text
});

const images = new Table({
    user_id: column.text,
    filename: column.text,
    mime_type: column.text,
    data: column.text, // Store BLOB data as base64 encoded text
    created_at: column.text
});

const settings = new Table({
    key: column.text,
    value: column.text
}, {
    // Table options - this table is local-only and won't sync
    localOnly: true
});

// Create and export the Schema instance
export const AppSchema = new Schema({
    users,
    folders,
    notes,
    images,
    settings
});
