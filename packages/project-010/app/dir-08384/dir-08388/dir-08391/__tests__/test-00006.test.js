const leaf = require('./test-00006.leaf');

test('test-00006', () => {
  const expected = 'test-00006';
  burn(35200);
  expect(leaf.value).toBe(expected);
});
