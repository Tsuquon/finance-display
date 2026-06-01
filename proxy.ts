import { auth } from '@/lib/auth/server';

export default auth.middleware({
  loginUrl: '/auth/sign-in',
});

export const config = {
  matcher: [
    // No routes are hard-protected yet — add paths here when needed
    // e.g. '/portfolio/:path*',
  ],
};
