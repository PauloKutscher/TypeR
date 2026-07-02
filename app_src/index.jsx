import "babel-polyfill";
import './index.scss';
import './rtl.scss';
import './lib/CSInterface';
import './lib/themeManager';

import React from 'react';
import ReactDOM from 'react-dom';
import { ContextProvider } from './context';
import HotkeysListner from './hotkeys';
import MainComponent from './components/main/main';
import GlobalTooltip from './components/globalTooltip';

const App = React.memo(function App() {
  return (
    <ContextProvider>
      <HotkeysListner />
      <MainComponent />
      <GlobalTooltip />
    </ContextProvider>
  );
});

// Remplace createRoot(...).render(...) par ReactDOM.render :
ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('app')
);
