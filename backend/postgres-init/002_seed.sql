-- /backend/postgres-init/002_seed.sql
-- This script seeds the database with an initial user and some sample data.
-- The password for the user is 'password'. It is hashed using bcrypt.
-- Hash generated for 'password' (cost 10): $2a$10$9sS.s6L5s.p4z.e9C5z4XuA2f.d3vJ/C1d/2f.e8E7g3g.h3o.g8u

-- Seed Users
INSERT INTO users (id, email, password_hash) VALUES
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'test@example.com', '$2a$10$9sS.s6L5s.p4z.e9C5z4XuA2f.d3vJ/C1d/2f.e8E7g3g.h3o.g8u');

-- Seed Folders for the test user
INSERT INTO folders (id, user_id, name, parent_id) VALUES
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Project Alpha', NULL),
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Meeting Notes', 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12');

-- Seed Notes for the test user
-- We omit created_at and updated_at to let the database use the default values.
INSERT INTO notes (id, user_id, folder_id, title, content) VALUES
('n0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', NULL, 'Welcome to Panino', E'# Welcome to Panino!\n\nThis is your first note. You can edit it, create new notes, and organize them into folders.\n\n- Use Markdown for formatting.\n- Changes are saved automatically and synced across your devices.'),
('n0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', 'Q3 Planning', E'## Q3 Planning Session\n\n- Review Q2 results.\n- Finalize Q3 roadmap.\n- Assign owners to key initiatives.'),
('n0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'Initial Research', E'### Market Research\n\nCompetitor analysis is underway. Initial findings are promising.');