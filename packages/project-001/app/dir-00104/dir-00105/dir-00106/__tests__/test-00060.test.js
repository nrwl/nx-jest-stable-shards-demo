const leaf = require('./test-00060.leaf');

test('test-00060', () => {
  const expected = 'test-00060';
  burn(2682);
  expect(leaf.value).toBe(expected);
});
