import axios from 'axios';

export const askFizzy = async (prompt) => {
  try {
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: 'llama3',
      prompt: prompt,
      system: "You are Fizzy, a calm, friendly and intelligent assistant who helps users of all ages. Speak respectfully and kindly. Your job is to help people find the right clothes, suggest outfit combinations, and assist with tasks on the site. Speak clearly and avoid jokes or childish language. You are like a personal helper who truly cares.",
      stream: false
    });

    return response.data.response;
  } catch (error) {
    console.error('Fizzy error:', error);
    return "Sorry, I couldn't understand that.";
  }
};