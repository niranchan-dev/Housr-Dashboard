import './styles.css';
import Script from 'next/script';

export const metadata = {
  title: 'Housr Analytics',
  description: 'Housr Analytics Suite Dashboard',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://cdn.jsdelivr.net" />
      </head>
      <body data-theme="light">
        {children}
        
        {/* Load Chart.js dependency globally */}
        <Script 
          src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" 
          strategy="beforeInteractive"
        />
        
        {/* Load Chart.js Datalabels plugin */}
        <Script 
          src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js" 
          strategy="beforeInteractive"
        />

        {/* Load the client application script containing the RPC shim */}
        <Script 
          src="/app.js" 
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
