import IntakeDock from '@/components/IntakeDock';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<IntakeDock /></>;
}
