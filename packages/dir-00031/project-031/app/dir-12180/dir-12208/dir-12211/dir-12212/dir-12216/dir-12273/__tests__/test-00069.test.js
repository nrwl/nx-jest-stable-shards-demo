const leaf = require('./test-00069.leaf');

test('test-00069', () => {
  const expected = 'test-00069';
  burn(9457);
  expect(leaf.value).toBe(expected);
});
