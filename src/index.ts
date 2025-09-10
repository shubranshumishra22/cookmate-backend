import 'dotenv/config';
import app from './app.js';

// Log environment variables for debugging (safely)
console.log('Environment check:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('SUPABASE_URL present:', !!process.env.SUPABASE_URL);
console.log('SUPABASE_SERVICE_ROLE_KEY present:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('GEMINI_API_KEY present:', !!process.env.GEMINI_API_KEY);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
