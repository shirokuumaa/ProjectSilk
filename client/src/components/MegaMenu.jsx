import React from 'react';
import styles from './MegaMenu.module.css';
  
  export default function MegaMenu() {
    return (
      <div className={styles.megaMenuContainer} style={{ backgroundColor: 'pink'}}>
        {/* Left section */}
        <div className={styles.left}>
          <ul>
            <li>Home & Kitchen</li>
            <li>Women’s Clothing</li>
            <li>Men’s Clothing</li>
            <li>Shoes</li>
            <li>Beauty & Health</li>
            <li>Kids</li>
            <li>Electronics</li>
          </ul>
        </div>
  
        {/* Right section */}
        <div className={styles.right}>
  {["Bath", "Storage", "Lighting", "Cleaning", "Decor"].map((item, index) => (
    <div key={index} className={styles.subItem}>
      <img src={`https://via.placeholder.com/60?text=${item}`} alt={item} />
      <p>{item}</p>
    </div>
  ))}
</div>
      </div>
    );
  }