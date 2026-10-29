"use client";

import Link from "next/link";
import { useParams as useNextParams, usePathname, useRouter } from "next/navigation";
import {
  forwardRef,
  useEffect,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";

type NavigateOptions = { replace?: boolean; state?: unknown };

export function useNavigate() {
  const router = useRouter();
  return (to: string | number, options?: NavigateOptions) => {
    if (typeof to === "number") {
      if (to < 0) router.back();
      else router.forward();
      return;
    }
    if (options?.replace) router.replace(to);
    else router.push(to);
  };
}

export function useParams<T extends Record<string, string | undefined>>() {
  return useNextParams() as T;
}

export { usePathname };

export function useLocation() {
  const pathname = usePathname() ?? "/";
  const search =
    typeof window !== "undefined" && window.location.pathname === pathname ? window.location.search : "";
  return { pathname, search, hash: "", state: null, key: "default" };
}

type NavLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className"> & {
  to: string;
  end?: boolean;
  children?: ReactNode | ((props: { isActive: boolean }) => ReactNode);
  className?: string | ((props: { isActive: boolean }) => string);
};

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(
  { to, end, children, className, ...rest },
  ref,
) {
  const pathname = usePathname() ?? "/";
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  const resolvedClass = typeof className === "function" ? className({ isActive }) : className;
  const child = typeof children === "function" ? children({ isActive }) : children;
  return (
    <Link ref={ref} href={to} className={resolvedClass} {...rest}>
      {child}
    </Link>
  );
});

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (replace) router.replace(to);
    else router.push(to);
  }, [replace, router, to]);
  return null;
}

/** Next layouts pass `children`; legacy routes used `<Outlet />`. */
export function Outlet({ context: _context }: { context?: unknown }) {
  return null;
}

export function useOutletContext<T>(): T {
  const { useShellOutletContext } = require("@/lib/shell-context") as typeof import("@/lib/shell-context");
  return useShellOutletContext() as T;
}

export function createBrowserRouter() {
  throw new Error("createBrowserRouter is not used in the Next.js app");
}

export function RouterProvider() {
  throw new Error("RouterProvider is not used in the Next.js app");
}
