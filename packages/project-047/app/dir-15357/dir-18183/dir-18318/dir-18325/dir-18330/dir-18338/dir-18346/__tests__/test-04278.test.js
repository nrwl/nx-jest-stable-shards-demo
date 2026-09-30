const leaf = require('./test-04278.leaf');

test('test-04278', () => {
  const expected = 'test-04278';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
