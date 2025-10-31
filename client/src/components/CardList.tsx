import React from 'react';
import CardItem from './CardItem';
import './CardList.css';

interface CardListProps {
  items: string[];
  onDelete: (index: number) => void;
}

const CardList: React.FC<CardListProps> = ({ items, onDelete }) => {
  return (
    <div className="card-list">
      {items.map((item, index) => (
        <CardItem
          key={index}
          itemValue={item}
          onDelete={() => onDelete(index)}
        />
      ))}
    </div>
  );
};

export default CardList;
