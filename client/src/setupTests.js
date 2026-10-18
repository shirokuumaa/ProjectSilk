// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// react-router 7 needs TextEncoder/TextDecoder, which the jsdom of CRA's Jest 27 lacks
import { TextEncoder, TextDecoder } from 'util';
if (!global.TextEncoder) Object.assign(global, { TextEncoder, TextDecoder });
