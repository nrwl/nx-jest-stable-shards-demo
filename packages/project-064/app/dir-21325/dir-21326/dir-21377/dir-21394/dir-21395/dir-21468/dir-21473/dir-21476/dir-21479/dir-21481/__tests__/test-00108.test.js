const leaf = require('./test-00108.leaf');

test('test-00108', () => {
  const expected = 'test-00108';
  burn(2883);
  expect(leaf.value).toBe(expected);
});
