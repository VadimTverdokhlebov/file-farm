import React, { useState } from 'react';
import './AddItem.css';
import CardList from './CardList';

const AddItem: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [items, setItems] = useState<string[]>([]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
  };

  const handleAddClick = () => {
    if (inputValue.trim() !== '') {
      setItems((prevItems) => [...prevItems, inputValue]);
      setInputValue('');
    }
  };

  const handleDeleteItem = (index: number) => {
    setItems((prevItems) => prevItems.filter((_, i) => i !== index));
  };

  return (
    <div className="main-container">
      <div className="add-item-container">
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            placeholder="Cow number"
            className="add-item-input"
          />
          <button onClick={handleAddClick} className="add-item-button">
            Add
          </button>
      </div>
      <div className="card-list-container">
        <CardList items={items} onDelete={handleDeleteItem} />
      </div>
    </div>
  );
};

export default AddItem;
