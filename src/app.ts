import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { translateText, translateBatch, detectLanguage, SUPPORTED_LANGUAGES, type LanguageCode } from './translation.js';

// Validate required environment variables
const requiredEnvVars = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY
};

for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

console.log('All required environment variables are present');

const app = express();

app.use(helmet());
app.use(cors({ 
  origin: [
    'http://localhost:3000', 
    'https://cookmate-flame.vercel.app',
    process.env.CLIENT_ORIGIN || ''
  ].filter(url => url !== ''),
  credentials: true
}));
app.use(express.json());
app.use(morgan('combined'));

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey); // For JWT validation

// Create RLS-aware client from request token
function supabaseFromRequest(token?: string) {
  if (!token) return createClient(supabaseUrl, supabaseAnonKey);
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

// Auth middleware
interface AuthedReq extends express.Request {
  user?: { authId: string; email: string };
}

async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  console.log('requireAuth middleware called');
  console.log('Headers:', req.headers.authorization);
  
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    console.log('No token provided');
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  console.log('Token found:', token.substring(0, 20) + '...');

  try {
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    console.log('Supabase auth result:', { user: user?.id, error: error?.message });
    
    if (error || !user) {
      console.log('Invalid token or user not found');
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    (req as AuthedReq).user = { authId: user.id, email: user.email! };
    console.log('Auth successful for user:', user.id);
    next();
  } catch (err) {
    console.log('Auth error:', err);
    res.status(401).json({ error: 'Auth failed' });
  }
}

// Validation schemas
const RoleSelectionBody = z.object({
  role: z.enum(['RESIDENT', 'WORKER'])
});

const ProfileBody = z.object({
  name: z.string().min(1),
  phone: z.string().min(10),
  block: z.string().optional(),
  flatNo: z.string().optional(),
  age: z.number().min(1).optional()
});

const WorkerProfileBody = z.object({
  workerType: z.enum(['COOK', 'MAID', 'BOTH']),
  cuisine: z.enum(['NORTH', 'SOUTH', 'BOTH']).optional(),
  experienceYrs: z.number().min(0).default(0),
  charges: z.number().min(1),
  longTermOffer: z.string().optional(),
  timeSlots: z.any().optional() // JSON object
});

const ServicePostBody = z.object({
  title: z.string().min(1),
  cuisine: z.enum(['NORTH', 'SOUTH', 'BOTH']).optional(),
  price: z.number().min(1),
  serviceArea: z.string().optional(),
  availableTiming: z.string().optional(),
  description: z.string().optional(),
  timeSlots: z.any().optional() // JSON object for specific timing
});

const RequirementPostBody = z.object({
  needType: z.enum(['COOK', 'MAID', 'BOTH']),
  details: z.string().optional(),
  preferredTiming: z.string().optional(),
  preferredPrice: z.number().min(0).optional(),
  block: z.string().optional(),
  flatNo: z.string().optional(),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM')
});

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Step 1: Role Selection (mandatory first step)
app.post('/select-role', requireAuth, async (req, res) => {
  console.log('POST /select-role called with body:', req.body);
  
  const parsed = RoleSelectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'Invalid role. Must be RESIDENT or WORKER' });
    return;
  }

  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    
    console.log('POST /select-role - authId:', authId, 'role:', parsed.data.role);
    
    // Check if user already exists
    const { data: existingUser, error: euErr } = await s
      .from('users')
      .select('id, role')
      .eq('auth_id', authId)
      .maybeSingle();
    
    if (euErr) {
      console.error('Failed to load user:', euErr);
      res.status(500).json({ error: 'Failed to load user', details: euErr.message });
      return;
    }
    
    let userId: string;
    
    if (!existingUser) {
      // Create new user with selected role
      const ins = await s
        .from('users')
        .insert({ auth_id: authId, role: parsed.data.role })
        .select('id')
        .single();
      
      if (ins.error) {
        console.error('Failed to create user:', ins.error);
        res.status(500).json({ error: 'Failed to create user', details: ins.error.message });
        return;
      }
      userId = ins.data.id;
      console.log('POST /select-role - created new user:', userId, 'with role:', parsed.data.role);
    } else {
      // Update existing user's role
      const updateRes = await s
        .from('users')
        .update({ role: parsed.data.role })
        .eq('auth_id', authId)
        .select('id')
        .single();
      
      if (updateRes.error) {
        console.error('Failed to update user role:', updateRes.error);
        res.status(500).json({ error: 'Failed to update role', details: updateRes.error.message });
        return;
      }
      userId = updateRes.data.id;
      console.log('POST /select-role - updated user role:', userId, 'to:', parsed.data.role);
    }
    
    res.json({ success: true, userId, role: parsed.data.role });
  } catch (err) {
    console.error('POST /select-role error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Step 2: Profile Creation (after role selection)
app.post('/profile', requireAuth, async (req, res) => {
  console.log('POST /profile called with body:', req.body);
  
  const parsed = ProfileBody.safeParse(req.body);
  if (!parsed.success) {
    console.log('POST /profile validation failed:', parsed.error.flatten());
    res.status(422).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    
    console.log('POST /profile - authId:', authId);
    
    // Check if user exists and has a role
    const { data: existingUser, error: euErr } = await s
      .from('users')
      .select('id, role')
      .eq('auth_id', authId)
      .maybeSingle();
    
    console.log('POST /profile - existingUser:', existingUser);
    
    if (euErr) { 
      console.error('Failed to load user:', euErr); 
      res.status(500).json({ error: 'Failed to load user', details: euErr.message }); 
      return; 
    }
    
    if (!existingUser || !existingUser.role) {
      res.status(400).json({ error: 'Please select your role first using /select-role' });
      return;
    }
    
    const userId = existingUser.id;
    const normalizedPhone = parsed.data.phone.trim();
    
    console.log('POST /profile - using userId:', userId);
    
    // Check if profile already exists
    const { data: existingProfile } = await s
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    
    let profileRes;
    if (existingProfile) {
      // Update existing profile and set verified to true since they're completing their profile
      console.log('POST /profile - updating existing profile:', existingProfile.id);
      profileRes = await s
        .from('profiles')
        .update({
          name: parsed.data.name,
          phone: normalizedPhone,
          block: parsed.data.block || null,
          flat_no: parsed.data.flatNo || null,
          age: parsed.data.age || null,
          verified: true, // Auto-verify when profile is completed
        })
        .eq('user_id', userId)
        .select('*')
        .single();
    } else {
      // Create new profile and set verified to true since they're completing their profile
      console.log('POST /profile - creating new profile for user:', userId);
      profileRes = await s
        .from('profiles')
        .insert({
          user_id: userId,
          name: parsed.data.name,
          phone: normalizedPhone,
          block: parsed.data.block || null,
          flat_no: parsed.data.flatNo || null,
          age: parsed.data.age || null,
          verified: true, // Auto-verify when profile is created
        })
        .select('*')
        .single();
    }
    
    console.log('POST /profile - profile result:', profileRes);
    
    if (profileRes.error) {
      console.error('profiles operation error', profileRes.error);
      const code = (profileRes.error as any)?.code;
      const msg = (profileRes.error as any)?.message || '';
      
      if (code === '23505') { // unique violation
        if (msg.includes('phone')) {
          res.status(409).json({ error: 'Phone number already in use' });
        } else {
          res.status(409).json({ error: 'Profile already exists' });
        }
      } else {
        res.status(500).json({ error: 'Failed to save profile', details: msg });
      }
      return;
    }
    
    console.log('POST /profile - success');
    res.json(profileRes.data);
  } catch (err) {
    console.error('POST /profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user info
app.get('/me', requireAuth, async (req, res) => {
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    
    const { data: user } = await s.from('users_view').select('*').eq('auth_id', authId).maybeSingle();
    res.json(user);
  } catch (err) {
    console.error('GET /me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sync auth state - now with auto user creation
app.post('/auth/sync', requireAuth, async (req, res) => {
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    
    let { data: user } = await s.from('users_view').select('*').eq('auth_id', authId).maybeSingle();
    
    // If user doesn't exist in users table, create them with default role
    if (!user) {
      console.log('User not found in users table, creating entry for auth_id:', authId);
      
      const { data: newUser, error: createError } = await s
        .from('users')
        .insert({ 
          auth_id: authId, 
          role: 'RESIDENT' // Default role, they can change it later
        })
        .select('id')
        .single();
      
      if (createError) {
        console.error('Failed to auto-create user:', createError);
        res.status(500).json({ error: 'Failed to create user account', details: createError.message });
        return;
      }
      
      console.log('Auto-created user:', newUser.id, 'for auth_id:', authId);
      
      // Fetch the newly created user from users_view
      const { data: freshUser } = await s.from('users_view').select('*').eq('auth_id', authId).maybeSingle();
      user = freshUser;
    }
    
    res.json({ user });
  } catch (err) {
    console.error('POST /auth/sync error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get services (public)
app.get('/services', async (req, res) => {
  try {
    const s = supabaseFromRequest();
    const { data: services } = await s.from('service_posts_view').select('*').eq('is_active', true).order('created_at', { ascending: false });
    
    res.json({ services: services || [] });
  } catch (err) {
    console.error('GET /services error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Post a service (workers only)
app.post('/services', requireAuth, async (req, res) => {
  console.log('POST /services called with body:', req.body);
  
  const parsed = ServicePostBody.safeParse(req.body);
  if (!parsed.success) {
    console.log('POST /services validation failed:', parsed.error.flatten());
    res.status(422).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    
    // Get worker profile
    const { data: user } = await s
      .from('users')
      .select('id, role')
      .eq('auth_id', authId)
      .maybeSingle();
    
    if (!user || user.role !== 'WORKER') {
      res.status(403).json({ error: 'Only workers can post services' });
      return;
    }
    
    const { data: workerProfile } = await s
      .from('worker_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    
    if (!workerProfile) {
      res.status(400).json({ error: 'Please complete your worker profile first' });
      return;
    }
    
    const serviceRes = await s
      .from('service_posts')
      .insert({
        worker_id: workerProfile.id,
        title: parsed.data.title,
        cuisine: parsed.data.cuisine || null,
        price: parsed.data.price,
        service_area: parsed.data.serviceArea || null,
        available_timing: parsed.data.availableTiming || null,
        description: parsed.data.description || null,
        time_slots: parsed.data.timeSlots || null,
      })
      .select('*')
      .single();
    
    if (serviceRes.error) {
      console.error('Failed to create service post:', serviceRes.error);
      res.status(500).json({ error: 'Failed to create service post', details: serviceRes.error.message });
      return;
    }
    
    console.log('POST /services - success');
    res.json(serviceRes.data);
  } catch (err) {
    console.error('POST /services error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get my services (workers only)
app.get('/my-services', requireAuth, async (req, res) => {
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    
    const { data: services } = await s
      .from('service_posts_view')
      .select('*')
      .eq('auth_id', authId)
      .order('created_at', { ascending: false });
    
    res.json({ services: services || [] });
  } catch (err) {
    console.error('GET /my-services error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle service active status (workers only)
app.patch('/services/:id/toggle', requireAuth, async (req, res) => {
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    const serviceId = req.params.id;
    
    // Verify ownership
    const { data: service } = await s
      .from('service_posts_view')
      .select('id, is_active')
      .eq('id', serviceId)
      .eq('auth_id', authId)
      .maybeSingle();
    
    if (!service) {
      res.status(404).json({ error: 'Service not found or not owned by you' });
      return;
    }
    
    const updateRes = await s
      .from('service_posts')
      .update({ is_active: !service.is_active })
      .eq('id', serviceId)
      .select('*')
      .single();
    
    if (updateRes.error) {
      res.status(500).json({ error: 'Failed to update service', details: updateRes.error.message });
      return;
    }
    
    res.json(updateRes.data);
  } catch (err) {
    console.error('PATCH /services/:id/toggle error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete service post (workers only)
app.delete('/services/:id', requireAuth, async (req, res) => {
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    const { serviceId } = req.params;

    // Verify ownership
    const { data: service, error: fetchError } = await s
      .from('service_posts_view')
      .select('*')
      .eq('id', serviceId)
      .eq('auth_id', authId)
      .single();

    if (fetchError || !service) {
      res.status(404).json({ error: 'Service not found or not owned by you' });
      return;
    }
    
    const deleteRes = await s
      .from('service_posts')
      .delete()
      .eq('id', serviceId);
    
    if (deleteRes.error) {
      res.status(500).json({ error: 'Failed to delete service', details: deleteRes.error.message });
      return;
    }
    
    res.json({ success: true, message: 'Service deleted successfully' });
  } catch (err) {
    console.error('DELETE /services/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete requirement
app.delete('/requirements/:id', requireAuth, async (req, res) => {
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    const { id: requirementId } = req.params;

    // Get user ID from auth ID
    const { data: user } = await s
      .from('users')
      .select('id')
      .eq('auth_id', authId)
      .single();

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Verify ownership
    const { data: requirement, error: fetchError } = await s
      .from('requirements')
      .select('*')
      .eq('id', requirementId)
      .eq('owner_id', user.id)
      .single();

    if (fetchError || !requirement) {
      res.status(404).json({ error: 'Requirement not found or not owned by you' });
      return;
    }
    
    const deleteRes = await s
      .from('requirements')
      .delete()
      .eq('id', requirementId);
    
    if (deleteRes.error) {
      res.status(500).json({ error: 'Failed to delete requirement', details: deleteRes.error.message });
      return;
    }
    
    res.json({ success: true, message: 'Requirement deleted successfully' });
  } catch (err) {
    console.error('DELETE /requirements/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get requirements (public)
app.get('/requirements', async (req, res) => {
  try {
    const s = supabaseFromRequest();
    const { data: requirements } = await s.from('requirements_view').select('*').eq('is_open', true).order('created_at', { ascending: false });
    res.json({ requirements: requirements || [] });
  } catch (err) {
    console.error('GET /requirements error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Post a requirement (residents only)
app.post('/requirements', requireAuth, async (req, res) => {
  console.log('POST /requirements called with body:', req.body);
  
  const parsed = RequirementPostBody.safeParse(req.body);
  if (!parsed.success) {
    console.log('POST /requirements validation failed:', parsed.error.flatten());
    res.status(422).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    
    // Check user role
    const { data: user } = await s
      .from('users')
      .select('id, role')
      .eq('auth_id', authId)
      .maybeSingle();
    
    if (!user || user.role !== 'RESIDENT') {
      res.status(403).json({ error: 'Only residents can post requirements' });
      return;
    }
    
    const reqRes = await s
      .from('requirements')
      .insert({
        owner_id: user.id,
        need_type: parsed.data.needType,
        details: parsed.data.details || null,
        preferred_timing: parsed.data.preferredTiming || null,
        preferred_price: parsed.data.preferredPrice || null,
        block: parsed.data.block || null,
        flat_no: parsed.data.flatNo || null,
        urgency: parsed.data.urgency,
      })
      .select('*')
      .single();
    
    if (reqRes.error) {
      console.error('Failed to create requirement:', reqRes.error);
      res.status(500).json({ error: 'Failed to create requirement', details: reqRes.error.message });
      return;
    }
    
    console.log('POST /requirements - success');
    res.json(reqRes.data);
  } catch (err) {
    console.error('POST /requirements error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Worker Profile Management
app.post('/worker-profile', requireAuth, async (req, res) => {
  console.log('POST /worker-profile called with body:', req.body);
  
  const parsed = WorkerProfileBody.safeParse(req.body);
  if (!parsed.success) {
    console.log('POST /worker-profile validation failed:', parsed.error.flatten());
    res.status(422).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    
    // Check if user exists and is a WORKER
    const { data: existingUser, error: euErr } = await s
      .from('users')
      .select('id, role')
      .eq('auth_id', authId)
      .maybeSingle();
    
    if (euErr) { 
      console.error('Failed to load user:', euErr); 
      res.status(500).json({ error: 'Failed to load user', details: euErr.message }); 
      return; 
    }
    
    if (!existingUser || existingUser.role !== 'WORKER') {
      res.status(400).json({ error: 'Only workers can create worker profiles' });
      return;
    }
    
    const userId = existingUser.id;
    
    // Check if worker profile already exists
    const { data: existingWorkerProfile } = await s
      .from('worker_profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    
    let workerProfileRes;
    if (existingWorkerProfile) {
      // Update existing worker profile
      console.log('POST /worker-profile - updating existing profile:', existingWorkerProfile.id);
      workerProfileRes = await s
        .from('worker_profiles')
        .update({
          worker_type: parsed.data.workerType,
          cuisine: parsed.data.cuisine || null,
          experience_yrs: parsed.data.experienceYrs,
          charges: parsed.data.charges,
          long_term_offer: parsed.data.longTermOffer || null,
          time_slots: parsed.data.timeSlots || null,
        })
        .eq('user_id', userId)
        .select('*')
        .single();
    } else {
      // Create new worker profile
      console.log('POST /worker-profile - creating new profile for user:', userId);
      workerProfileRes = await s
        .from('worker_profiles')
        .insert({
          user_id: userId,
          worker_type: parsed.data.workerType,
          cuisine: parsed.data.cuisine || null,
          experience_yrs: parsed.data.experienceYrs,
          charges: parsed.data.charges,
          long_term_offer: parsed.data.longTermOffer || null,
          time_slots: parsed.data.timeSlots || null,
        })
        .select('*')
        .single();
    }
    
    console.log('POST /worker-profile - result:', workerProfileRes);
    
    if (workerProfileRes.error) {
      console.error('worker_profiles operation error', workerProfileRes.error);
      res.status(500).json({ error: 'Failed to save worker profile', details: workerProfileRes.error.message });
      return;
    }
    
    console.log('POST /worker-profile - success');
    res.json(workerProfileRes.data);
  } catch (err) {
    console.error('POST /worker-profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/worker-profile', requireAuth, async (req, res) => {
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);
    
    // Get user ID
    const { data: user } = await s
      .from('users')
      .select('id, role')
      .eq('auth_id', authId)
      .maybeSingle();
    
    if (!user || user.role !== 'WORKER') {
      res.status(404).json({ error: 'Worker profile not found' });
      return;
    }
    
    const { data: workerProfile } = await s
      .from('worker_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    
    if (!workerProfile) {
      res.status(404).json({ error: 'Worker profile not found' });
      return;
    }
    
    res.json(workerProfile);
  } catch (err) {
    console.error('GET /worker-profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Translation endpoints
app.get('/languages', (req, res) => {
  res.json({ languages: SUPPORTED_LANGUAGES });
});

app.post('/translate', async (req, res) => {
  try {
    const schema = z.object({
      text: z.string().min(1),
      fromLanguage: z.string(),
      toLanguage: z.string(),
      context: z.enum(['service', 'requirement', 'profile', 'general']).optional()
    });

    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request format', details: result.error.flatten() });
    }

    const { text, fromLanguage, toLanguage, context } = result.data;

    // Validate language codes
    if (!(fromLanguage in SUPPORTED_LANGUAGES) || !(toLanguage in SUPPORTED_LANGUAGES)) {
      return res.status(400).json({ error: 'Unsupported language code' });
    }

    const translatedText = await translateText({
      text,
      fromLanguage: fromLanguage as LanguageCode,
      toLanguage: toLanguage as LanguageCode,
      context
    });

    res.json({ 
      originalText: text,
      translatedText,
      fromLanguage,
      toLanguage,
      context 
    });
  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ error: 'Translation failed' });
  }
});

app.post('/translate-batch', async (req, res) => {
  try {
    const schema = z.object({
      texts: z.array(z.string().min(1)),
      fromLanguage: z.string(),
      toLanguage: z.string(),
      context: z.enum(['service', 'requirement', 'profile', 'general']).optional()
    });

    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request format', details: result.error.flatten() });
    }

    const { texts, fromLanguage, toLanguage, context } = result.data;

    // Validate language codes
    if (!(fromLanguage in SUPPORTED_LANGUAGES) || !(toLanguage in SUPPORTED_LANGUAGES)) {
      return res.status(400).json({ error: 'Unsupported language code' });
    }

    const translatedTexts = await translateBatch(
      texts,
      fromLanguage as LanguageCode,
      toLanguage as LanguageCode,
      context
    );

    res.json({ 
      originalTexts: texts,
      translatedTexts,
      fromLanguage,
      toLanguage,
      context 
    });
  } catch (error) {
    console.error('Batch translation error:', error);
    res.status(500).json({ error: 'Batch translation failed' });
  }
});

app.post('/detect-language', async (req, res) => {
  try {
    const schema = z.object({
      text: z.string().min(1)
    });

    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request format', details: result.error.flatten() });
    }

    const { text } = result.data;
    const detectedLanguage = await detectLanguage(text);

    res.json({ 
      text,
      detectedLanguage,
      languageName: SUPPORTED_LANGUAGES[detectedLanguage]
    });
  } catch (error) {
    console.error('Language detection error:', error);
    res.status(500).json({ error: 'Language detection failed' });
  }
});

// Admin endpoint to verify users (can be used for manual verification)
app.post('/admin/verify-user', requireAuth, async (req, res) => {
  try {
    const schema = z.object({
      userId: z.string().uuid().optional(),
      authId: z.string().uuid().optional(),
      verified: z.boolean().default(true)
    });

    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request format', details: result.error.flatten() });
    }

    const { userId, authId, verified } = result.data;
    
    if (!userId && !authId) {
      return res.status(400).json({ error: 'Either userId or authId must be provided' });
    }

    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);

    let targetUserId = userId;
    
    // If authId provided, get userId
    if (authId && !userId) {
      const { data: user } = await s
        .from('users')
        .select('id')
        .eq('auth_id', authId)
        .maybeSingle();
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      targetUserId = user.id;
    }

    // Update profile verification status
    const updateRes = await s
      .from('profiles')
      .update({ verified })
      .eq('user_id', targetUserId)
      .select('*')
      .single();

    if (updateRes.error) {
      console.error('Failed to update verification status:', updateRes.error);
      return res.status(500).json({ error: 'Failed to update verification status', details: updateRes.error.message });
    }

    res.json({ 
      success: true, 
      message: `User ${verified ? 'verified' : 'unverified'} successfully`,
      profile: updateRes.data 
    });
  } catch (error) {
    console.error('Admin verify user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Self-verification endpoint for users who have completed profiles
app.post('/verify-me', requireAuth, async (req, res) => {
  try {
    const authId = (req as AuthedReq).user!.authId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const s = supabaseFromRequest(token);

    // Get user and profile info
    const { data: user } = await s
      .from('users_view')
      .select('*')
      .eq('auth_id', authId)
      .maybeSingle();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has completed their profile
    const hasBasicProfile = user.name && user.phone;
    const hasWorkerProfile = user.role !== 'WORKER' || (user.worker_type && user.charges && user.experience_yrs !== null);
    
    if (!hasBasicProfile || !hasWorkerProfile) {
      return res.status(400).json({ 
        error: 'Please complete your profile before requesting verification',
        missing: {
          basicProfile: !hasBasicProfile,
          workerProfile: user.role === 'WORKER' && !hasWorkerProfile
        }
      });
    }

    // Auto-verify if profile is complete
    const updateRes = await s
      .from('profiles')
      .update({ verified: true })
      .eq('user_id', user.id)
      .select('*')
      .single();

    if (updateRes.error) {
      console.error('Failed to verify user:', updateRes.error);
      return res.status(500).json({ error: 'Failed to verify user', details: updateRes.error.message });
    }

    res.json({ 
      success: true, 
      message: 'Profile verified successfully!',
      profile: updateRes.data 
    });
  } catch (error) {
    console.error('Self-verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
