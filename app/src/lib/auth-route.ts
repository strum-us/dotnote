export const AUTH_LOGIN_PATH = "/login";
export const AUTH_CREATE_PATH = "/createaccount";

export function isAuthCreatePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === AUTH_CREATE_PATH;
}
