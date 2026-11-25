// The page links of the signed-in bar, in display order.
export const navLinks: { href: string; label: string }[] = [
  // A new signed-in page adds one entry here. The comment also keeps the list on several lines after remove:sample.
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/courses", label: "Courses" },
  // BEGIN sample-resource
  { href: "/dashboard/notes", label: "Notes" },
  // END sample-resource
];

// The account links. Each shell and the phone menu show them right before Sign out.
// A new account page adds one entry here, not in navLinks.
export const accountLinks: { href: string; label: string }[] = [{ href: "/dashboard/settings", label: "Settings" }];

// Returns the href of the current link: the longest href that is the path, or a prefix of it before a slash.
// A plain prefix match makes Dashboard and Notes both current on /dashboard/notes. The longest href wins.
// The account links are in the match, so on an account page no page link is current.
export function currentNavHref(path: string): string | undefined {
  return [...navLinks, ...accountLinks]
    .map(({ href }) => href)
    .filter((href) => path === href || path.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}
