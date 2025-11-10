import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { FilesPage } from './pages/FilesPage';
import { LoadTestPage } from './pages/LoadTestPage';

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<FilesPage />} />
         <Route path="/load-test" element={<LoadTestPage />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
