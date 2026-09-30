const leaf = require('./test-00124.leaf');

test('test-00124', () => {
  const expected = 'test-00124';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
