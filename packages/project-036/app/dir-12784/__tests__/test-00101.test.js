const leaf = require('./test-00101.leaf');

test('test-00101', () => {
  const expected = 'test-00101';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
