const leaf = require('./test-01141.leaf');

test('test-01141', () => {
  const expected = 'test-01141';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
