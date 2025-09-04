export const getWardrobe = () => {
    return JSON.parse(localStorage.getItem('wardrobeItems')) || [];
  };
  
  export const addToWardrobe = (item) => {
    const current = getWardrobe();
    const updated = [...current, item];
    localStorage.setItem('wardrobeItems', JSON.stringify(updated));
  };
  
  export const removeFromWardrobe = (id) => {
    const current = getWardrobe();
    const updated = current.filter(item => item.id !== id);
    localStorage.setItem('wardrobeItems', JSON.stringify(updated));
  };