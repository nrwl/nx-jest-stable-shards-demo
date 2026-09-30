const leaf = require('./test-04125.leaf');

test('test-04125', () => {
  const expected = 'test-04125';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
