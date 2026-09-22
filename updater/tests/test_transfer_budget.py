import http.server
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.request
from updater.broker.releases import transfer
from updater.broker.auth import Denied


class TransferBudgetTests(unittest.TestCase):
    def setUp(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Length', '4')
                self.end_headers()
                self.wfile.write(b'demo')
            def log_message(self, format, *args):
                pass
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:%s/file' % self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def clock(self, later):
        values = iter([0, 0])
        return SimpleNamespace(monotonic=lambda: next(values, later))

    def test_payload_download_can_continue_after_two_minutes(self):
        with tempfile.TemporaryDirectory() as work:
            destination = Path(work) / 'payload'
            with patch('updater.broker.releases.time', self.clock(121)):
                transfer(self.url, destination=destination, fixture=True)
            self.assertEqual(destination.read_bytes(), b'demo')

    def test_payload_still_has_ten_minute_absolute_limit(self):
        with tempfile.TemporaryDirectory() as work:
            with patch('updater.broker.releases.time', self.clock(601)):
                with self.assertRaises(Denied):
                    transfer(self.url, destination=Path(work) / 'payload', fixture=True)

    def test_metadata_and_explicit_shorter_deadlines_stay_bounded(self):
        with patch('updater.broker.releases.time', self.clock(121)):
            with self.assertRaises(Denied):
                transfer(self.url, fixture=True)
        with tempfile.TemporaryDirectory() as work:
            with patch('updater.broker.releases.time', self.clock(9)):
                with self.assertRaises(Denied):
                    transfer(self.url, destination=Path(work) / 'payload', fixture=True, deadline=8)

    def test_connection_timeout_size_limit_and_cancellation_remain(self):
        original = urllib.request.OpenerDirector.open
        with tempfile.TemporaryDirectory() as work:
            with patch.object(urllib.request.OpenerDirector, 'open', autospec=True, side_effect=original) as opened:
                transfer(self.url, destination=Path(work) / 'payload', fixture=True)
                self.assertEqual(opened.call_args.kwargs['timeout'], 5)
            with self.assertRaises(Denied):
                transfer(self.url, destination=Path(work) / 'oversize', fixture=True, limit=3)
            with self.assertRaises(Denied):
                transfer(self.url, destination=Path(work) / 'cancelled', fixture=True, cancelled=lambda: True)
