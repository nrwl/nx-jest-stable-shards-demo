const leaf = require('./test-00027.leaf');

test('test-00027', () => {
  const expected = 'test-00027';
  burn(32450);
  expect(leaf.value).toBe(expected);
});
