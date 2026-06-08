export { default } from "next-auth/middleware";

export const config = {
  // Enforce authentication on the root dashboard page and RPC APIs
  matcher: [
    "/",
    "/api/rpc"
  ]
};
