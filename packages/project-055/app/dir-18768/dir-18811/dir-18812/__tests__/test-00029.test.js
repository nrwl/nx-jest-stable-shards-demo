const leaf = require('./test-00029.leaf');

test('test-00029', () => {
  const expected = 'test-00029';
  burn(25810);
  expect(leaf.value).toBe(expected);
});
