import { SessionPlayer } from "./player";

export const metadata = { title: "Session" };

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SessionPlayer sessionId={id} />;
}
