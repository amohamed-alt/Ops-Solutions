import './globals.css';
import './sdr-dashboard.css';

import { CustomerNavigation } from '@/components/customer/CustomerNavigation';

export const metadata = {
  title: 'Ops Solutions',
  description: 'Intelligent HubSpot analytics platform'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <CustomerNavigation />
      </body>
    </html>
  );
}
