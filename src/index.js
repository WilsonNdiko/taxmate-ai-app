import React from 'react';
import ReactDOM from 'react-dom/client';
import './App.css'; // Optional: If you have global styles
import Home from './Home'; // Import your main component (renamed from App to Home in my previous guide)

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Home /> {/* Or <App /> if you kept that name */}
  </React.StrictMode>
);