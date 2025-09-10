# CookMate Backend API

RESTful API backend for CookMate - connecting users with skilled cooks and reliable house cleaners.

## 🚀 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Deployment**: Railway/Heroku/Render

## ✨ Features

- Supabase JWT auth middleware and `/auth/sync` to upsert local users
- Profiles, worker profiles, service posts, requirements board, applications
- Worker search filters with location-based matching
- Translation API for multi-language support
- Zod validation, Helmet security, CORS, structured logging

## 🛠️ Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account and project

### Installation

1. Clone the repository:
```bash
git clone https://github.com/shubranshumishra22/cookmate-backend.git
cd cookmate-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

4. Configure your `.env` file with Supabase credentials:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (from Supabase Settings > API)
   - `CLIENT_ORIGIN` for CORS configuration

5. Set up database:
   - In Supabase SQL Editor, run `supabase/schema.sql` to create tables and views
   - Run migration files in order: `migration.sql`, `policies.sql`, `complete_migration.sql`

6. Build and start the server:
```bash
npm run build
npm run dev
```

## 📦 Available Scripts

- `npm run dev` – Start development server with watch mode
- `npm run build` – Compile TypeScript to `dist/`
- `npm run start` – Run compiled production build
- `npm run clean` – Clean build directory

## 🗄️ Database Schema

### Core Tables
- **profiles** - User profiles and preferences
- **worker_profiles** - Service provider details
- **service_posts** - Available services (cooking/cleaning)
- **requirements** - Service requests from users
- **applications** - Applications to service requirements
- **messages** - Communication between users

## 🚀 Deployment

### Railway (Recommended)
1. Connect repository to [Railway](https://railway.app)
2. Set environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CLIENT_ORIGIN`
3. Deploy automatically on push

### Render
- **Build Command**: `npm run build`
- **Start Command**: `npm run start`
- **Environment Variables**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLIENT_ORIGIN`

### Heroku
```bash
heroku create cookmate-backend
heroku config:set SUPABASE_URL=your_url
heroku config:set SUPABASE_SERVICE_ROLE_KEY=your_key
git push heroku main
```

## 🔗 Frontend Repository

Frontend Next.js application: [CookMate Frontend](https://github.com/shubranshumishra22/cookmate-frontend)

## 🔒 Security Notes

- Keep the Supabase service role key secure and server-side only
- CORS configured for specific frontend origins
- Row Level Security (RLS) enabled on all tables
- JWT token validation for protected routes

## 🚧 Future Enhancements

- Real-time messaging using WebSocket/Socket.io
- Push notifications for new bookings
- Payment integration
- Advanced matching algorithms
# cookmate-backend
