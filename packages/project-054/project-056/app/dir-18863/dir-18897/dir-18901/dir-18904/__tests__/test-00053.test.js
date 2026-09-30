const leaf = require('./test-00053.leaf');

test('test-00053', () => {
  const expected = 'test-00053';
  burn(35382);
  expect(leaf.value).toBe(expected);
});
