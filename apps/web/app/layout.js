import './globals.css';
import './sdr-dashboard.css';

export const metadata = {
  title: 'Ops Solutions',
  description: 'Intelligent HubSpot analytics platform'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
