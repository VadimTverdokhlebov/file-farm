export const activateLed = async (animal_num: any) => {
    try {
      const response = await fetch('http://localhost:3000/api/activate',{
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ animal_num })
      });
      const [data] = await response.json();
      console.log('activateLed:', data);
      return data
    } catch (error) {
      console.error('Error fetching data:', error);
    }
};

export const getStatusLed = async (animal_num: any) => {
    try {
      const response = await fetch('http://localhost:3000/api/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ animal_num })
      });
      const [data] = await response.json();
      console.log('getStatusLed:', data);
      return data
    } catch (error) {
      console.error('Error fetching data:', error);
    }
};