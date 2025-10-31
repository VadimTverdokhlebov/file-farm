import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { FilesPage } from './pages/FilesPage';

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<FilesPage />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
