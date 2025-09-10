-- Complete Migration Script for CookMaid
-- This ensures ALL required views, tables, and policies are in place
-- Run this in Supabase SQL Editor

-- First, ensure all tables have the required columns
ALTER TABLE service_posts ADD COLUMN IF NOT EXISTS service_area text;
ALTER TABLE service_posts ADD COLUMN IF NOT EXISTS available_timing text;
ALTER TABLE service_posts ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE requirements ADD COLUMN IF NOT EXISTS preferred_timing text;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS preferred_price int;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS block text;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS flat_no text;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'MEDIUM';

-- Add constraint for urgency if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'requirements_urgency_check'
    ) THEN
        ALTER TABLE requirements ADD CONSTRAINT requirements_urgency_check 
        CHECK (urgency IN ('LOW','MEDIUM','HIGH'));
    END IF;
END $$;

-- Drop and recreate ALL views to ensure they exist
DROP VIEW IF EXISTS users_view CASCADE;
DROP VIEW IF EXISTS workers_view CASCADE;
DROP VIEW IF EXISTS service_posts_view CASCADE;
DROP VIEW IF EXISTS requirements_view CASCADE;

-- Create users_view (CRITICAL for authentication)
CREATE VIEW users_view AS
SELECT u.*, p.name, p.phone, p.block, p.flat_no, p.age, p.verified,
       wp.worker_type, wp.cuisine, wp.experience_yrs, wp.charges, wp.long_term_offer, wp.rating, wp.rating_count, wp.time_slots
FROM users u
LEFT JOIN profiles p ON p.user_id = u.id
LEFT JOIN worker_profiles wp ON wp.user_id = u.id;

-- Create workers_view (CRITICAL for worker listings)
CREATE VIEW workers_view AS
SELECT wp.*, u.auth_id, p.name, p.phone, p.block, p.flat_no
FROM worker_profiles wp
JOIN users u ON u.id = wp.user_id
LEFT JOIN profiles p ON p.user_id = u.id;

-- Create service_posts_view
CREATE VIEW service_posts_view AS
SELECT 
    sp.id,
    sp.worker_id,
    sp.title,
    sp.cuisine,
    sp.price,
    sp.service_area,
    sp.available_timing,
    sp.description,
    sp.time_slots,
    sp.is_active,
    sp.created_at,
    sp.updated_at,
    wp.user_id, 
    wp.rating, 
    wp.rating_count, 
    wp.experience_yrs, 
    u.role, 
    u.auth_id, 
    p.name, 
    p.phone
FROM service_posts sp
JOIN worker_profiles wp ON wp.id = sp.worker_id
JOIN users u ON u.id = wp.user_id
LEFT JOIN profiles p ON p.user_id = u.id;

-- Create requirements_view
CREATE VIEW requirements_view AS
SELECT 
    r.id,
    r.owner_id,
    r.need_type,
    r.details,
    r.preferred_timing,
    r.preferred_price,
    r.block,
    r.flat_no,
    r.urgency,
    r.is_open,
    r.created_at,
    r.updated_at,
    u.role, 
    p.name, 
    p.phone, 
    p.block as profile_block, 
    p.flat_no as profile_flat_no
FROM requirements r
JOIN users u ON u.id = r.owner_id
LEFT JOIN profiles p ON p.user_id = u.id;

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirement_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "users_select_self" ON users;
DROP POLICY IF EXISTS "users_insert_self" ON users;
DROP POLICY IF EXISTS "users_upsert_self" ON users;
DROP POLICY IF EXISTS "users_update_self" ON users;
DROP POLICY IF EXISTS "profiles_policy" ON profiles;
DROP POLICY IF EXISTS "worker_profiles_policy" ON worker_profiles;
DROP POLICY IF EXISTS "service_posts_policy" ON service_posts;
DROP POLICY IF EXISTS "service_posts_select" ON service_posts;
DROP POLICY IF EXISTS "service_posts_modify" ON service_posts;
DROP POLICY IF EXISTS "requirements_policy" ON requirements;
DROP POLICY IF EXISTS "requirements_select" ON requirements;
DROP POLICY IF EXISTS "requirements_modify" ON requirements;

-- Create optimized RLS policies
CREATE POLICY "users_select_self" ON users
FOR SELECT USING (auth_id = (select auth.uid()));

CREATE POLICY "users_insert_self" ON users
FOR INSERT WITH CHECK (auth_id = (select auth.uid()));

CREATE POLICY "users_update_self" ON users
FOR UPDATE USING (auth_id = (select auth.uid()));

CREATE POLICY "profiles_policy" ON profiles
FOR ALL USING (
  user_id IN (
    SELECT id FROM users WHERE auth_id = (select auth.uid())
  )
);

CREATE POLICY "worker_profiles_policy" ON worker_profiles
FOR ALL USING (
  user_id IN (
    SELECT id FROM users WHERE auth_id = (select auth.uid())
  )
);

CREATE POLICY "service_posts_select" ON service_posts
FOR SELECT USING (true); -- Public read access

CREATE POLICY "service_posts_modify" ON service_posts
FOR ALL USING (
  worker_id IN (
    SELECT wp.id FROM worker_profiles wp
    JOIN users u ON u.id = wp.user_id
    WHERE u.auth_id = (select auth.uid())
  )
);

CREATE POLICY "requirements_select" ON requirements
FOR SELECT USING (true); -- Public read access

CREATE POLICY "requirements_modify" ON requirements
FOR ALL USING (
  owner_id IN (
    SELECT id FROM users WHERE auth_id = (select auth.uid())
  )
);

-- Grant necessary permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Grant public read access to views (CRITICAL)
GRANT SELECT ON users_view TO anon, authenticated;
GRANT SELECT ON workers_view TO anon, authenticated;
GRANT SELECT ON service_posts_view TO anon, authenticated;
GRANT SELECT ON requirements_view TO anon, authenticated;

-- Grant usage on uuid functions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

COMMIT;
