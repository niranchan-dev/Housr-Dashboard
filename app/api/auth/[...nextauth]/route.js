import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;

      const adminEmails = process.env.ADMIN_EMAILS
        ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase())
        : ['niranchan@housr.in'];

      // Allow users with @housr.in email or explicitly whitelisted admin emails
      if (email.endsWith('@housr.in') || adminEmails.includes(email)) {
        return true;
      }
      
      console.warn(`Access denied for email: ${email}`);
      return false; // Denies access and redirects to error page
    },
    async session({ session }) {
      if (session?.user) {
        const email = session.user.email?.toLowerCase();
        const adminEmails = process.env.ADMIN_EMAILS
          ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase())
          : ['niranchan@housr.in'];

        session.user.isAdmin = adminEmails.includes(email);
        session.user.email = email;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  }
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
