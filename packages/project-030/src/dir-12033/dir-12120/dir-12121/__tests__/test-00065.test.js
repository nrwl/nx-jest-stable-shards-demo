const leaf = require('./test-00065.leaf');

test('test-00065', () => {
  const expected = 'test-00065';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
