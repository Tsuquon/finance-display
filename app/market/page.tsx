import { redirect } from "next/navigation";

// The market view is now the homepage; keep this path as a redirect so any old
// /market links still resolve.
export default function MarketPage() {
  redirect("/");
}
