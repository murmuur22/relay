"""Disposable network validation; never invokes installation or host changes."""
import unittest
import socket
import importlib.util
from pathlib import Path
from unittest.mock import patch
from updater.tests.test_deployment import installer
from updater.broker.driver import network_host, network_origin
from updater.broker.auth import Denied

class PrivateLANTests(unittest.TestCase):
    def test_web_sandbox_allows_interface_enumeration_without_capabilities(self):
        unit = (Path(__file__).resolve().parents[2] / 'updater/web/relay-updater-web.service').read_text()
        self.assertIn('RestrictAddressFamilies=AF_UNIX AF_INET AF_NETLINK\n', unit)
        self.assertIn('CapabilityBoundingSet=\n', unit)
        self.assertIn('AmbientCapabilities=\n', unit)
        self.assertIn('NoNewPrivileges=true\n', unit)

    def test_qualifier_threads_network_and_hardened_restore(self):
        path = Path(__file__).resolve().parents[2] / 'deploy/qualify-systemd.py'
        spec = importlib.util.spec_from_file_location('relay_lan_qualify', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(hasattr(module, 'NETWORK'), 'Qualifier must select exact origin')
        module.NETWORK = module.install.deployment_network('10.20.30.40')
        with patch.object(module, 'HTTPConnection') as connection:
            connection.return_value.getresponse.return_value.read.return_value = b'{}'
            connection.return_value.getresponse.return_value.getheader.return_value = ''
            module.http(4180, '/health/ready')
            self.assertEqual(connection.call_args.args[0], '10.20.30.40')
            self.assertEqual(connection.return_value.request.call_args.kwargs['headers']['Origin'], 'http://10.20.30.40:4180')
        command = module.restore_command('v0.4.1')
        self.assertEqual(command[-2:], ['--private-lan', '10.20.30.40'])
        self.assertIn('--property=ProtectSystem=strict', command)

    def test_explicit_private_matrix(self):
        for host in ('10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.254', '192.168.0.1'):
            self.assertEqual(network_host(host, 'private-lan'), host)
            self.assertEqual(network_origin('http://' + host + ':4191', 'private-lan').hostname, host)
            with self.assertRaises(Denied):
                network_host(host)
        for host in ('127.0.0.1','localhost','0.0.0.0','169.254.169.254','8.8.8.8','224.0.0.1','172.15.0.1','172.32.0.1','192.169.0.1','10.01.1.1','167772161','0x0a000001','10.1','::1','user@10.0.0.1','10.0.0.1/'):
            with self.subTest(host=host), self.assertRaises(Denied):
                network_host(host, 'private-lan')
        for suffix in ('/','?x','#x','/path', ':bad'):
            with self.assertRaises(Denied):
                network_origin('http://10.0.0.1:4191' + suffix, 'private-lan')

    def test_installer_network_plan_and_pre_mutation_rejection(self):
        m = installer()
        self.assertTrue(hasattr(m, 'deployment_network'), 'Missing explicit installer LAN plan')
        self.assertEqual(m.deployment_network(None), dict(networkMode='loopback', hostname='localhost', bind='127.0.0.1', relayOrigin='http://localhost:4180', uiOrigin='http://localhost:4191'))
        cfg = m.deployment_network('10.20.30.40')
        self.assertEqual(cfg['bind'], '10.20.30.40')
        self.assertEqual(cfg['uiOrigin'], 'http://10.20.30.40:4191')
        with patch.object(m, 'run') as command:
            with self.assertRaises(m.InstallError):
                m.apply_install(Path('/unused'), {}, 'v0.4.1', '0.0.0.0')
            command.assert_not_called()

    def test_preflight_rejects_occupied_exact_port(self):
        m = installer()
        self.assertTrue(hasattr(m, 'preflight_network'), 'Missing actual bind preflight')
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1', 0))
            occupied.listen(1)
            with self.assertRaises(m.InstallError):
                m.preflight_network(None, ports=(occupied.getsockname()[1],))
        m.preflight_network(None, ports=(0,))

    def test_cli_threads_private_lan_into_apply(self):
        m = installer()
        with patch.object(m, 'prepare') as prepare, patch.object(m, 'apply_install') as apply:
            prepare.return_value.__enter__.return_value = (Path('/synthetic'), {})
            m.main(['--release-dir','/synthetic','--version','v0.4.1','--private-lan','10.20.30.40','--apply'])
            self.assertEqual(prepare.call_args.args[0].private_lan, '10.20.30.40')
            self.assertEqual(apply.call_args.args[-1], '10.20.30.40')
